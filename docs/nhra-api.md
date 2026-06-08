# NHRA Data API integration

Live timing can come from **two interchangeable sources**, selectable per-event
via the **Source** toggle in the navbar footer:

- **API** (default) — the official `api.nhra.com` (Azure API Management).
  Client + mapper: `src/lib/nhra-api.ts`.
- **getresults** — the legacy `getresults.nhradata.com` scraper:
  `src/lib/scraper.ts`.

Both produce identical `RunRow[]`, so persistence (`insertRuns`), dedup, and the
entire app are **source-agnostic**. The choice lives in `LiveConfig.dataSource`
(localStorage) and is POSTed to `/api/fetch-data`, which branches on it:

```
LiveDataProvider (dataSource) → POST /api/fetch-data
  dataSource === "scraper" → loginAndFetch()        (scraper.ts)
  else                     → fetchEventRunsViaApi()  (nhra-api.ts)  [default]
→ invalidateEventCache → insertRuns → logFetch   (shared tail)
```

## Authentication

- Header **`Ocp-Apim-Subscription-Key: <key>`** (APIM subscription
  "GetResultsGoogleApp").
- The key is read from **`process.env.NHRA_API_KEY`** (server-only). Set it as a
  secret, the same way `NHRA_USERNAME` / `NHRA_PASSWORD` are wired. For Firebase
  App Hosting, add it to `apphosting.yaml` **after** the secret exists in Secret
  Manager (referencing a missing secret fails the build).
- **`Cache-Control: no-cache`** bypasses APIM's response cache; the live path
  sends it (mirrors the app's force-dynamic/no-store stance).
- Primary **and** Secondary keys exist → rotate without downtime.

## Endpoints (server cache TTL signals intended volatility)

| Group | Path | TTL | Purpose |
|---|---|---|---|
| Event | `/event/EventType/{ET}/StartDate/{YYYYMMDD}/Count/{n}` | 45s | latest N runs (live poll) |
| Event | `/event/EventType/{ET}/StartDate/{YYYYMMDD}/Updated/Count/{n}` | 45s | recently **changed** runs (edits) |
| Event | `/event/EventType/{ET}/StartDate/{YYYYMMDD}[?racer]` | 15m | **Full** event (used by `fetchEventRunsViaApi`) |
| Event | `/event/EventType/{ET}/StartDate/{YYYYMMDD}/Slips[?timestamp]` | 15m | full event, time-sliced |
| Event | `/event/EventType/{ET}/StartDate/{YYYYMMDD}/Category/{CAT}[?racer][&carnumber]` | 30m | one class |
| Event | `/event/EventType/{ET}/StartDate/{YYYYMMDD}/Categories` | 30m | classes that ran |
| Event | `/event/EventType/{ET}/StartDate/{YYYYMMDD}/SessionType/{T\|Q\|C\|E}[?category][&round][&racer][&carnumber]` | 30m | by session |
| Event | `/event/EventType/{ET}/StartDate/{YYYYMMDD}/Winners` | 30m | winners + runner-ups |
| Event | `/event/apiauth/api/entrylist[?StartDate]` | — | entry list (different path/auth) |
| HMS | `/hms/Active` | 2m | events live right now |
| HMS | `/hms/[?year]` | 15m | every event for a year + status |
| HMS | `/hms/EventType[?eventType]` | — | event-type listing for the year |
| — | `/NationalEventList` | — | current-season national feed |

`{ET}` = `N, D1…D7`. Category path is upper-snake (`TOP_FUEL`); `carnumber`
takes a comma list (`41,44`).

## Run object → RunRow mapping (`mapApiRunsToRunRows`)

- **Paired schema**: each object describes one pairing; `left*`/`right*` split
  into up to two per-lane `RunRow`s. A lane is emitted if it has any identity
  **or** any timing (so solo/bye lanes survive).
- **Timestamp**: `name` = `YYYYMMDDHHMMSS` (24-hour) →
  `M/D/YYYY h:mm:ss AM/PM`. The AM/PM is **computed from real 24h time, not
  inferred** — this sidesteps the scraper's `inferAmPm()`/`tagRunTimestamps()`
  reason for existing. (Downstream `tagRunTimestamps` still re-tags but
  reproduces the same marker.)
- **4-wide**: the 2nd pair = 1st + 1s and can read `SS=60`. `parseApiTimestamp`
  builds through `Date`, so `…30:60` normalizes to `…31:00` and the pairs land
  1s apart — inside the 1-second tolerance `buildTimestampGroups()` uses to
  merge quad pairs.
- **Identity**: `left/rightID` is the NHRA member id — the stable key the
  tech-cards/contacts system already uses.
- Field map: `RT→rt`, `60/330/660/1000/1320ft→ft*`, `*mph→mph_*`,
  `DialIn→dial_in`, `QualPos→qual_pos`, `MOV→mov`, `Win==="W"→is_winner/result`.
- `_scrape_seq` is assigned in true chronological order (the API returns
  newest-first; `tagRunTimestamps` walks ascending).

## TODO-verify (needs live responses to confirm)

- `leftFirst`/`rightFirst` semantics (margin? package?) — currently **unmapped**.
- `leftFlags` vocabulary → `is_dq` (currently non-empty ⇒ dq, mirroring the
  scraper's DQ column).
- `place` — no direct API field (set null).
- ~~Lane string parity~~ **(resolved)** — the mapper emits `1`/`2` (the
  getresults grid vocabulary that `normalLane()` understands), and `dedupKey()`
  canonicalizes lane via `laneKey()`, so an API row and a scraper row for the
  same physical run share a dedup key and merge instead of doubling (a 2-wide
  pair was rendering as a bogus 4-wide). 4-wide lane 3/4 labels still TODO.
- Response shapes for HMS, Winners, EntryList, Slips, Categories (typed loosely).
- HMS event identity fields (EventType/StartDate/EventCode) — the bridge from the
  app's `event_code`+`season` model to the API's `EventType`+`StartDate` keys.

## Sandbox note

`api.nhra.com` is **firewalled from the dev sandbox** (`host_not_allowed`), like
`getresults.nhradata.com`. The API path can't be exercised end-to-end from
sandbox sessions — it works from the deployed Cloud Run app. The mapper is
verified offline against a real sample payload.
