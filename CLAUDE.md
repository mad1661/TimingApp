# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server (localhost:3000)
npm run build    # production build (output: "standalone")
npm run start    # serve the production build
npm run lint     # next lint — the only automated check in this repo
npm run backfill # one-time historical scrape into Firestore (see below)
```

There is **no test framework** configured. Validate changes with `npm run lint` and by running the app (`npm run dev`).

`npm run backfill` (runs `scripts/backfill.ts` via `tsx`) must run **locally, not in the sandbox** — getresults.nhradata.com is firewalled there. It needs `NHRA_USERNAME`, `NHRA_PASSWORD`, and Firestore credentials (`GOOGLE_APPLICATION_CREDENTIALS` or the `FB_ADMIN_*` env vars). It checkpoints to `.backfill-progress.json` and is safe to re-run (writes dedupe).

## Stack & deployment

Next.js 14 App Router (React 18, TypeScript `strict`), Tailwind CSS v4 (theme tokens like `nhra-red`/`nhra-card` come from the `@theme` block in `src/app/globals.css` — **not** the vestigial `tailwind.config.ts`; see Gotchas), Firebase Admin SDK → Firestore. Deployed to Cloud Run via **Firebase App Hosting** (`apphosting.yaml`), which injects `NHRA_USERNAME`/`NHRA_PASSWORD` secrets and `FB_ADMIN_PROJECT_ID`. Import alias: `@/*` → `src/*`.

## Architecture

### The data pipeline (read these files together to understand the app)

1. **Scrape** — `src/lib/scraper.ts`. NHRA timing data lives behind an ASP.NET WebForms site (`getresults.nhradata.com`). The scraper logs in and drives the ViewState/postback sequence (year → event type → event → optional date dropdown), then parses the `#runGridView` table into `RunRow[]`. It caches authenticated sessions (cookies + a warm ViewState) for ~10 min so polling can do a "fast refresh" without re-logging in.

2. **Persist + cache** — `src/lib/db.ts` is the **server-only** data layer (it imports `firebase-admin`; never import it from a client component). Runs are stored as **batched array documents** at `events_data/{eventCode}_{season}/run_batches`. db.ts keeps a **per-event in-memory LRU cache** (max 3 events, 30 s TTL). The TTL matters: the cache is per-Cloud-Run-instance, so without it one instance keeps serving stale data after another instance writes. `invalidateEventCache()` is called before scraping to force a reload.

3. **Dedupe** — every run gets `_dedup_key = timestamp|car|round|lane|event|season` (AM/PM stripped). `insertRuns()` only writes new/changed rows, so re-scraping is cheap and idempotent.

### Timestamp AM/PM inference (central domain quirk)

CompuLink emits timestamps **without an AM/PM marker**. `inferAmPm()` (scraper.ts) and `tagRunTimestamps()` (db.ts) reconstruct it by walking each day's runs chronologically: start in AM, flip to PM at the noon crossing (hour hits 12, or drops e.g. 11→1). A large amount of downstream logic (schedule, round ordering, "recent runs") depends on this ordering being correct — be careful editing it. Related: 4-wide ("quad") rounds get bogus timestamps for the second pair; `parseRunsFromHtml` repairs these, but **only** for rounds `detectFourWideRounds()` confirms are genuinely 4-wide, so normal 2-wide pairs aren't mis-merged.

### Client data flow

The app is effectively a client SPA. `LiveDataProvider` (React context, `src/components/LiveDataProvider.tsx`) stores the live event config — **including the user's NHRA username/password** — in `localStorage` (`timindata_live_config`) and polls `POST /api/fetch-data` every `intervalSeconds`. Credentials are sent from the browser. Pages read everything else from `/api/*` route handlers, which call into `db.ts`.

`layout.tsx` → `LiveDataProvider` → `AppShell`. `AppShell` renders `Navbar` + `EventBanner`, but hides that chrome for the setup screen (`/` with no config) and the standalone `/day/*` and `/share` pages. `page.tsx` shows `SetupFlow` when there's no config, else `Dashboard`. The full feature list is the `NAV_ITEMS` array in `Navbar.tsx`.

### Public sharing (no client credentials)

`/share` + `POST /api/public-fetch` scrape using the **server-side** `NHRA_USERNAME`/`NHRA_PASSWORD` env vars, so a read-only schedule can be shared without exposing credentials in the browser. It refreshes the most-recently-scheduled event and enumerates the event's date dropdown to fetch every day.

### Tech Cards → Contacts & Mailing

- Stored in the `tech_cards` Firestore collection, keyed by **`member_number_category`**. Member number is the stable identity (a racer's car number changes between events), with car number as fallback.
- Populated two ways: (a) **spreadsheet upload** via `/tech-cards` → `parseTechCardWorkbook` (`src/lib/tech-card-parse.ts`); (b) **bulk scrape** via `/tech-card-backfill`, which pulls from two sources — the Tech Card Viewer site (`src/lib/techcardviewer-scraper.ts`) and racefiles Compulink Excel exports (`src/lib/racefiles-compulink.ts`).
- **`/contacts` (Contacts & Mailing)** reads `GET /api/tech-cards?all=1` and **collapses many tech-card rows into one `Contact` per person** (by member number, merging categories/email/phone/address). It offers year/category/division/event filters and bulk actions: print **mailing labels** (opens a print window with a 3-column Avery-5160-style grid), **copy emails**, **copy phones**, and a **mailto bcc** link. It's a fully client-side page — no contacts-specific API route.
- Tech cards also feed no-show detection: `getMissingFromEliminations()` in db.ts cross-references entered cars against actual runs, matching scrape categories (e.g. "SUPER STREET") to tech-card class codes (e.g. "SST") via `CATEGORY_CODE_TABLE`.

### Domain glossary

- **Rounds**: `Q*` qualifying, `E*` eliminations, `T*` time trials/test, `F` final (`roundSortKey` / `roundSortWeight` order them).
- **Categories** are NHRA classes. A category is treated as **bracket** vs **heads-up** by whether the majority of its elimination runs carry a `dial_in`.
- **Metrics on `RunRow`**: `rt` reaction time, `ft60/330/660/1000/1320` elapsed time at distance (1320 ft = the finish / ET), `mph_*` trap speeds, `dial_in`. Derived: **package** = `rt + (ET − dial_in)`, **breakout** = `ET < dial_in`.

## Gotchas

- **`firestore.rules` is wide open** (`allow read, write: if true`). There is no auth at the database layer.
- Scraping API routes declare `export const dynamic = "force-dynamic"` and return no-store cache headers. This is deliberate — defeating Next.js's data cache fixes a recurring "Refresh Data returns yesterday's runs" class of bug. Keep it when adding scrape endpoints.
- `firebase-admin` is listed in `serverComponentsExternalPackages` (next.config.mjs). `db.ts` and `firebase-admin.ts` are server-only.
- **Tailwind theme lives in `globals.css`, not `tailwind.config.ts`.** This is a CSS-first Tailwind v4 setup: the live tokens are the `@theme` block in `src/app/globals.css` (which also defines `nhra-accent`/`green`/`yellow`/`orange`, absent from the JS file). `tailwind.config.ts` is dead — v4 doesn't auto-load it (no `@config` directive), so editing it does nothing. Add/change colors in `globals.css`.
- Two different category classifiers coexist. The **bracket-vs-heads-up** distinction in the glossary is the dial-in-majority heuristic in `db.ts`; separately, `src/lib/categories.ts` (`classifyCategory`) regex-maps a class name to a `RaceFormat` (`bracket`/`index`/`heads_up`/`handicap`), used by the stats and racer-profile pages. They are independent — don't assume one drives the other.
