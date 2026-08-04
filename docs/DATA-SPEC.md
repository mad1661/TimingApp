# NHRA / CompuLink Timing Data — Integration Spec

This document is a complete handoff for building **another app** that parses the same
NHRA timing data this app (TiminData) uses. It covers where the data comes from, the
exact field layout, and — most importantly — every quirk you must handle for the data
to be correct. Everything here is implemented and battle-tested in this repo; file
references point at the authoritative code.

There are three ways another app can get the data. Pick one:

| Option | Best for | Section |
|---|---|---|
| A. Scrape getresults.nhradata.com yourself | Full independence | §1–§2 |
| B. Read this app's Firestore directly | Same data, no scraping | §7 |
| C. Call this app's HTTP API | Simplest; data already cleaned | §8 |

Options B and C give you data that has **already been repaired** (AM/PM, 4-wide fixes,
dedup). If you scrape yourself (Option A), you must reimplement §3 — that's where the
bodies are buried.

---

## 1. Source: getresults.nhradata.com (CompuLink live timing)

An ASP.NET WebForms site behind a login. Requires an NHRA member account
(`NHRA_USERNAME` / `NHRA_PASSWORD`). Reference implementation: `src/lib/scraper.ts`.

### 1.1 Login

1. `GET https://getresults.nhradata.com/login.aspx` — collect cookies and the WebForms
   hidden fields (`__VIEWSTATE`, `__VIEWSTATEGENERATOR`, `__EVENTVALIDATION`).
2. `POST https://getresults.nhradata.com/login.aspx?ReturnUrl=%2f` with
   `application/x-www-form-urlencoded` body: the hidden fields plus
   `LoginControl$UserName`, `LoginControl$Password`, `LoginControl$LoginButton=Log+In`.
3. Merge `Set-Cookie` values from both responses; send them on every later request.
   (Cookie merging: keep the last value per cookie name — `mergeCookies()`.)

A response that contains the login form again means the session expired — re-login.
Sessions are safe to cache ~2 minutes for fast re-polling (`SESSION_TTL_MS`).

### 1.2 Drill-down postback sequence

The results grid only renders after driving the WebForms dropdown chain on `GET /`.
Every step is a `POST /` with **all form fields collected from the previous response's
HTML** (every `<input>`/`<select>` value), overriding:

| Step | `__EVENTTARGET` | Fields to set |
|---|---|---|
| 1. Year + type | `eventTypeDropDown` | `yearDropDown` = season (e.g. `2026`), `eventTypeDropDown` = event type |
| 2. Event | `divEventRaceDropDown` | same two, plus `divEventRaceDropDown` = the event JSON string |
| 3. Day (optional) | `dateDropDown` | `dateDropDown` = a value from the date dropdown |

The event dropdown value is a JSON-ish string, exactly this format (single quotes,
spaces included):

```
{ 'EventType' : '<type>', 'StartDate' : '<start date>', 'EventCode' : '<code>', 'Season' : '<year>' }
```

Step 3 only exists for multi-day events; enumerate `#dateDropDown option` values to
fetch every day (that's how the public `/share` page assembles a whole event).
`__EVENTARGUMENT` is always sent, empty.

### 1.3 The results grid

The final response contains `<table id="runGridView">`. Skip the header row. Rows
with fewer than 22 `<td>` cells are chrome — skip. A row with no timestamp, no name
and no car number is empty — skip.

**Cell text gotcha:** some cells render the value inside a `<span>` while a sibling
text node carries extra info (e.g. an AM/PM marker after the timestamp). Take the full
cell text when it's strictly longer than the span text, else the span text.

### 1.4 Column map (0-indexed)

| Col | Field | Type | Notes |
|---|---|---|---|
| 0 | `timestamp` | string | `M/D/YYYY H:MM:SS` — **usually NO AM/PM marker** (§3.1) |
| 1 | `round` | string | `Q1`, `T2`, `E1`, `C1`, `F` … (§4) |
| 2 | `qual_pos` | number | qualifying position |
| 3 | `car_number` | string | car number as painted; **changes between events** |
| 4 | `name` | string | driver name; sometimes blank on one row of a pair |
| 5 | `class_index` | string | **class designation**, e.g. `SS/BA`, `A/SA`, `FS/A` — not a number (§5) |
| 6 | `rt` | number | reaction time |
| 7 | `ft60` | number | 60-ft elapsed time |
| 8 | `ft330` | number | 330-ft ET |
| 9 | `ft660` | number | 660-ft (eighth-mile) ET |
| 10 | `mph_660` | number | eighth-mile speed |
| 11 | `ft1000` | number | 1000-ft ET |
| 12 | `mph_1000` | number | 1000-ft speed |
| 13 | `ft1320` | number | quarter-mile ET — **the** ET |
| 14 | `mph_1320` | number | trap speed |
| 15 | `mov` | number | margin of victory (s), usually on the winner |
| 16 | `result` | string | `W` = win, `R` = runner-up, `3`/`4` = 4-wide finish position, blank |
| 17 | (DQ flag) | string | non-empty ⇒ disqualified (red-light, boundary, etc.) |
| 18 | `place` | string | |
| 19 | `category` | string | class name, e.g. `SUPER STOCK`, `STOCK ELIMINATOR` |
| 20 | `lane` | string | `1`/`2` or `L1`/`L2` (4-wide: `3`/`4`) |
| 21 | `dial_in` | number | **dial-in or class index** for that run (§5) |

Number parsing: `parseFloat` of trimmed text; empty/NaN ⇒ null. Blank timing fields
mean the car hasn't run (pre-staged placeholder) or broke before that clock.

---

## 2. Record schema

The canonical run record (see `RunRow` in `src/lib/db.ts`) is the 22 columns above
plus event metadata attached at scrape time: `event_code`, `event_name`, `event_type`,
`season`, `start_date`, and `_scrape_seq` (row order within the scrape — keep it; it's
the only reliable ordering when timestamps are equal or missing).

Derived flags this app stores: `is_winner` (1 iff col 16 == `W`), `is_dq`
(1 iff col 17 non-empty).

---

## 3. Repairs you MUST implement (if scraping yourself)

Apply in this order. Reference: `parseRunsFromHtml`, `inferAmPm`,
`detectFourWideRounds` in `src/lib/scraper.ts`; dedup in `src/lib/db.ts`.

### 3.1 AM/PM inference (the big one)

CompuLink emits timestamps **without an AM/PM marker**. `4/18/2026 1:05:22` could be
1 AM or 1 PM. Everything downstream (run order, round ordering, pairing, schedules)
breaks if you get this wrong. Algorithm (`inferAmPm`):

1. Group rows by calendar day.
2. Rows may be listed newest-first or oldest-first. Detect direction: count hour
   increases vs decreases between adjacent rows; if decreases win, reverse so you
   walk oldest-first.
3. Walk the day with a state machine starting in `AM`:
   - A row that already carries `AM`/`PM` sets the state (respect it).
   - Hour hits `12` → flip to `PM` (stay there for the rest of the day).
   - Hour **drops** vs the previous row (e.g. `11` → `1`) → crossed noon → `PM`.
   - First row of the day has hour ≤ 7 (too early for real racing) or 12, and no
     morning row seen yet → the day started in the afternoon → `PM`.
4. Rewrite the timestamp with the inferred marker appended: `M/D/YYYY H:MM:SS AM|PM`.

### 3.2 Phantom / future rows

The timing system posts **pairings before they run** (rows with a timestamp but no
timing data) and sometimes with a bogus far-future date. Drop or flag rows whose
parsed timestamp is more than **24 h in the future** (the cushion absorbs timezone
skew between your server and the track) **and** have no timing data
(`rt`, `ft60`, `ft660`, `ft1320` all null). Rows with no data at a *plausible* next
timestamp are the "next pair" about to run — useful, keep them flagged.

### 3.3 Four-wide (quad) timestamp repair

In 4-wide rounds the second pair (lanes 3/4) sometimes posts with a bogus date or a
time hours off. **Gate the repairs**: only treat `category|round` as 4-wide if at
least one exact timestamp in that round is shared by **3+ runs** (a genuinely recorded
quad — `detectFourWideRounds`). Without the gate these heuristics merge unrelated
2-wide pairs. Then, within 4-wide rounds only:

- **Date outliers:** if a run's date differs from the dominant date of the ~20
  surrounding rows, copy the timestamp of the nearest earlier same-category+round run
  on the dominant date.
- **Time outliers:** within one day+category+round group (6+ runs), compute each
  run's minutes-of-day and the group median. A run > 60 min from the median with ≤ 4
  runs within ±5 min of itself is bogus — snap it to the timestamp of the run closest
  to the median.

### 3.4 Dedup key (idempotent ingestion)

Re-scrapes and multi-source ingestion must not duplicate rows. Canonical identity:

```
dedup_key = TS | CAR | ROUND | LANE | EVENT_CODE | SEASON
```

- `TS`: timestamp parsed and reformatted `YYYYMMDDHHMMSS` (fall back to the raw
  string with AM/PM stripped if unparseable)
- `CAR`, `ROUND`: trimmed, uppercased
- `LANE` canonicalized: `L`/`L1`/`1`/`LEFT` → `1`; `R`/`L2`/`2`/`RIGHT` → `2`;
  `L3`/`3` → `3`; `L4`/`4` → `4`

On key match, overwrite only if the new row has more/changed data; never let a
re-scrape clobber a manual correction.

### 3.5 Near-duplicate pass collapse

The same physical pass can appear under **two different keys** when sources disagree
on its timestamp or lane (classic: a quad's 2nd pairing at +1 s with lanes 1/2 vs
merged at the 1st pairing's time with lanes 3/4). A car cannot make two passes in the
same round seconds apart, so rows with the same `car+round+category+event+season`
whose timestamps are within **10 s** are one pass — keep the richer row.

### 3.6 Name backfill

Occasionally one row of a pair has a car number but a blank name. Backfill from other
rows with the same car number at the same event.

---

## 4. Round codes & ordering

| Prefix | Meaning |
|---|---|
| `T*` | time trials / test |
| `Q*` | qualifying |
| `C*` | **class eliminations** rounds (Stock/Super Stock class racing) |
| `E*` | eliminations (E1 = round 1) |
| `F` | final |

Chronological weight within a day: `T` < `Q` < `C`/`E` < `F`. Do **not** sort rounds
purely lexicographically across types. Elimination depth for "how far did they get":
`E<n>` → n, `F` → beyond any `E`.

**Pairing runs into matchups:** a pair/quad = same `category` + `round` + timestamp,
with timestamps grouped using a **±1 s tolerance** (4-wide lanes 3/4 often post 1 s
after lanes 1/2; use ±3 s when hunting the most recent quad). See
`buildTimestampGroups` in `src/lib/timestamp-utils.ts`. There is **no opponent field**
— opponents are whoever shares the timestamp group.

**Win/loss:** winner ⇔ `result == "W"`, or `result` blank and the winner flag set.
`R`/`3`/`4` are finish positions (4-wide advances top 2). A bye run still gets `W`.
DQ (col 17) usually accompanies a loss but check `result` first. In 4-wide rounds
without result codes, rank finishers by `ft1320`.

---

## 5. Class racing: designations, indexes, dial-ins

Two different things live in the numbers, depending on round type:

- **`class_index` (col 5) is a string designation** — `SS/BA`, `A/SA`, `FS/A`,
  `GT/TB` — the car's class within the category. It is NOT numeric.
- **`dial_in` (col 21)** is:
  - in **Q/T rounds** for index classes (Stock, Super Stock, Comp): the car's
    **national class index** — qualifying order = `ft1320 − dial_in`, most negative
    (furthest under) first, ties to whoever ran first;
  - in **E rounds** for bracket/handicap racing: the driver's **dial-in** for that
    round (Stock/SS may dial under their index; it changes round to round).

Derived metrics used everywhere:
**package** = `rt + (ft1320 − dial_in)`; **breakout** = `ft1320 < dial_in`.
Same-class pairs in Stock/SS run heads-up — breakout doesn't apply.

**Transmission encoding in Super Stock designations:** suffix ending in `A` = automatic
(`SS/BA`), otherwise stick (`SS/B`) — EXCEPT these classes which don't encode it and
need the tech card / Tech: `SS/AH`, `SS/AS`–`GS`, `SS/AM`–`GM`, `SS/TA`–`TD`,
`SS/AX`–`EX`, `SS/VX`, `GT/TA`–`TD`. Stock: `A/SA` auto vs `A/S` stick; anything
starting `FS` is Factory Stock (no trans distinction). Class-eliminations grouping
rules and NHRA sportsman ladder charts (field sizes 2–32) are implemented in
`src/lib/class-elims.ts` — self-contained TypeScript, portable.

**Category ↔ class-code table** (for matching scrape categories to tech-card codes):
`TOP FUEL`→TF, `FUNNY CAR`→FC, `PRO STOCK`→PS, `PRO STOCK MOTORCYCLE`→PSM,
`PRO MOD`→PM, `TOP ALCOHOL DRAGSTER`→TAD, `TOP ALCOHOL FUNNY CAR`→TAFC,
`TOP DRAGSTER`→TD, `TOP SPORTSMAN`→TS, `FACTORY STOCK SHOWDOWN`→FSS,
`COMPETITION ELIMINATOR`→COMP, `SUPER COMP`→SC, `SUPER GAS`→SG, `SUPER STREET`→SST,
`SUPER STOCK`→SS, `STOCK (ELIMINATOR)`→STK, `SUPER PRO`→SPRO, `PRO ET`→PRO,
`SPORTSMAN`→SPTM, `SPORTSMAN MOTORCYCLE`→SMC, `JR DRAGSTER`→JR, `JR STREET`→JS.

**Identity warning:** car numbers change between events and differ across classes for
the same driver. The stable person identity is the **NHRA member number** (from tech
cards); driver name is the practical join key within one event.

---

## 6. Timestamp parsing reference

Accept: `M/D/YYYY H:MM[:SS][ AM|PM]` — 2- or 4-digit year (add 2000 if < 100),
optional seconds, optional AM/PM (possibly glued to the seconds with no space),
stray whitespace. `12 AM` → hour 0; `12 PM` → 12. See `parseTsToDate` in
`src/lib/timestamp-utils.ts`.

---

## 7. Option B: reading this app's Firestore

Project `nhra-timing-app`. Main collections:

| Path | Contents |
|---|---|
| `events_data/{EVENTCODE}_{SEASON}/run_batches/*` | run docs: each `{ runs: RunRow[] }`, ≤ 50 runs per doc. Concatenate all docs' arrays, drop `_phantom: true` rows, dedup by `_dedup_key` (keep `_edited` rows over source rows). Timestamps stored **with** inferred AM/PM. |
| `events` | one doc per stored event (code, season, name, type, start date) |
| `tech_cards` | doc id `{member_number|car_number}_{CATEGORY}`; driver, address, email/phone, class, member number |
| `class_indexes/{EVENT}_{SEASON}` | `{ indexes: { designation: number } }` |
| `class_elim_configs/{EVENT}_{SEASON}_{CATEGORY}` | class-elims stick/auto overrides + scratches |
| `ladder_headers`, `ladder_states` | ladder-builder persistence |
| `fetch_log` | scrape history |

Caveat: `firestore.rules` is currently wide open — coordinate before shipping anything
that writes.

## 8. Option C: consuming this app's HTTP API

Base: the deployed app (`https://timingapp--nhra-timing-app.us-east4.hosted.app`).
All endpoints return JSON with `no-store` cache headers. Most useful:

| Endpoint | Returns |
|---|---|
| `GET /api/runs?event_code=&season=&limit=&category=&round=` | cleaned runs + filter lists (categories, rounds, classes) |
| `GET /api/stats?type=dashboard&event_code=&season=` | event summary |
| `GET /api/stats?type=qualifying&category=&rounds=&mode=stock_super_stock` | qualifying order vs class index |
| `GET /api/stats?type=class-elims&category=` | class-elims breakdown (classes, combos, seeds) |
| `GET /api/stats?type=brackets&category=` | elimination runs + no-shows |
| `GET /api/stats?type=doubles` | doubled-up racers with per-class alive/lost status |
| `GET /api/tech-cards?all=1` | all tech cards |
| `POST /api/fetch-data` | triggers a fresh scrape (needs NHRA credentials in body) |

There is currently **no auth** on these endpoints.

---

## 9. Checklist for a correct implementation

1. ☐ AM/PM inference with direction detection (§3.1) — test on a day that starts
   in the afternoon and a day that crosses noon.
2. ☐ Future-phantom filtering with the 24 h cushion (§3.2).
3. ☐ 4-wide repairs gated on `detectFourWideRounds` (§3.3) — never on 2-wide rounds.
4. ☐ Canonicalized dedup key + 10 s same-pass collapse (§3.4–3.5).
5. ☐ Pair by category+round+timestamp group with ±1 s tolerance (§4).
6. ☐ Winner = `result == "W"` (blank + winner-flag fallback); handle `R`/`3`/`4`.
7. ☐ Treat `class_index` as a designation string; the numeric index is `dial_in`
   on Q/T runs; E-round `dial_in` is the round's dial (§5).
8. ☐ Round ordering `T < Q < C/E < F`, not lexicographic (§4).
9. ☐ Join people by member number (tech cards) or name — never car number across
   classes/events (§5).
10. ☐ Re-scrapes must be idempotent; manual edits must survive re-ingestion (§3.4).
