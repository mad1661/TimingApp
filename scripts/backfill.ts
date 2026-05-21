/**
 * One-time historical backfill of getresults.nhradata.com into Firestore.
 *
 * Logs in ONCE, then walks every (season, event type) combination, lists the
 * events, and scrapes every run of every event (all days) into the same
 * Firestore collections the live app uses. insertRuns() dedupes, so this is
 * safe to re-run and only ever adds new/changed rows.
 *
 * Progress is checkpointed to .backfill-progress.json after every event, so an
 * interrupted or killed run resumes where it left off instead of re-scraping.
 *
 * Run locally (NOT in the sandbox — getresults is firewalled there):
 *
 *   NHRA_USERNAME=you NHRA_PASSWORD=secret \
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *   npm run backfill
 *
 * Scope / tuning via env vars (all optional):
 *   SEASONS       e.g. "2009-2026" (range) or "2017,2018,2019" (list). Default: 2009-2026
 *   EVENT_TYPES   e.g. "N,D1" or "N,D1,D2,...,D7". Default: N,D1
 *   DELAY_MS      polite delay between requests, ms. Default: 1500
 *   CHECKPOINT    checkpoint file path. Default: .backfill-progress.json
 *   DRY_RUN       "1" to scrape + log counts but skip Firestore writes
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  nhraLogin,
  listEventsWithCookies,
  scrapeEventWithCookies,
  SessionExpiredError,
  type NhraEvent,
} from "../src/lib/scraper";
import { insertEvent, insertRuns } from "../src/lib/db";

// ----- config -----

function parseSeasons(raw: string | undefined): string[] {
  if (!raw) {
    const seasons: string[] = [];
    for (let y = 2026; y >= 2009; y--) seasons.push(String(y));
    return seasons;
  }
  if (raw.includes("-")) {
    const [a, b] = raw.split("-").map((s) => parseInt(s.trim(), 10));
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    const out: string[] = [];
    for (let y = hi; y >= lo; y--) out.push(String(y));
    return out;
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const USERNAME = process.env.NHRA_USERNAME || "";
const PASSWORD = process.env.NHRA_PASSWORD || "";
const SEASONS = parseSeasons(process.env.SEASONS);
const EVENT_TYPES = (process.env.EVENT_TYPES || "N,D1").split(",").map((s) => s.trim()).filter(Boolean);
const DELAY_MS = parseInt(process.env.DELAY_MS || "1500", 10);
const CHECKPOINT = resolve(process.cwd(), process.env.CHECKPOINT || ".backfill-progress.json");
const DRY_RUN = process.env.DRY_RUN === "1";

// ----- checkpoint -----

interface Progress {
  doneEvents: string[]; // "season|eventType|eventCode|startDate"
  totals: { events: number; runsInserted: number };
}

function eventKey(e: NhraEvent): string {
  return `${e.season}|${e.eventType}|${e.eventCode}|${e.startDate}`;
}

function loadProgress(): Progress {
  if (existsSync(CHECKPOINT)) {
    try {
      return JSON.parse(readFileSync(CHECKPOINT, "utf8")) as Progress;
    } catch {
      console.warn(`[backfill] Could not parse ${CHECKPOINT}; starting fresh.`);
    }
  }
  return { doneEvents: [], totals: { events: 0, runsInserted: 0 } };
}

function saveProgress(p: Progress): void {
  writeFileSync(CHECKPOINT, JSON.stringify(p, null, 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ----- session with auto re-login -----

let cookies = "";

async function ensureLogin(): Promise<void> {
  cookies = await nhraLogin(USERNAME, PASSWORD);
}

// Run an operation, transparently re-logging-in (once) if the session expired.
async function withSession<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      console.log("[backfill] Session expired — re-logging in...");
      await ensureLogin();
      return await op();
    }
    throw err;
  }
}

// ----- main -----

async function main(): Promise<void> {
  if (!USERNAME || !PASSWORD) {
    console.error("Missing NHRA_USERNAME / NHRA_PASSWORD env vars.");
    process.exit(1);
  }

  console.log("[backfill] Config:");
  console.log(`  seasons:     ${SEASONS.join(", ")}`);
  console.log(`  event types: ${EVENT_TYPES.join(", ")}`);
  console.log(`  delay:       ${DELAY_MS}ms`);
  console.log(`  checkpoint:  ${CHECKPOINT}`);
  console.log(`  dry run:     ${DRY_RUN}`);

  const progress = loadProgress();
  const done = new Set(progress.doneEvents);
  if (done.size > 0) console.log(`[backfill] Resuming — ${done.size} events already done.`);

  console.log("[backfill] Logging in...");
  await ensureLogin();
  console.log("[backfill] Logged in.");

  const failures: { event: string; error: string }[] = [];

  for (const season of SEASONS) {
    for (const eventType of EVENT_TYPES) {
      let events: NhraEvent[];
      try {
        events = await withSession(() => listEventsWithCookies(cookies, season, eventType));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[backfill] Failed to list ${season} ${eventType}: ${msg}`);
        failures.push({ event: `${season} ${eventType} (list)`, error: msg });
        continue;
      }

      console.log(`\n[backfill] ${season} ${eventType}: ${events.length} events`);
      await sleep(DELAY_MS);

      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const key = eventKey(ev);
        const tag = `[${season} ${eventType}] ${i + 1}/${events.length} ${ev.eventCode} (${ev.displayName})`;

        if (done.has(key)) {
          console.log(`  skip (done) ${tag}`);
          continue;
        }

        try {
          const runs = await withSession(() => scrapeEventWithCookies(cookies, ev));
          let inserted = 0;
          if (!DRY_RUN) {
            await insertEvent({
              event_code: ev.eventCode,
              event_type: ev.eventType,
              event_name: ev.displayName,
              season: ev.season,
              start_date: ev.startDate,
            });
            inserted = await insertRuns(ev.eventCode, ev.season, runs);
          }
          console.log(`  ok ${tag} — scraped ${runs.length}, inserted ${inserted}`);

          done.add(key);
          progress.doneEvents.push(key);
          progress.totals.events += 1;
          progress.totals.runsInserted += inserted;
          saveProgress(progress);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  FAIL ${tag} — ${msg}`);
          failures.push({ event: key, error: msg });
          // not checkpointed -> retried on next run
        }

        await sleep(DELAY_MS);
      }
    }
  }

  console.log("\n[backfill] ===== DONE =====");
  console.log(`  events imported: ${progress.totals.events}`);
  console.log(`  runs inserted:   ${progress.totals.runsInserted}`);
  if (failures.length > 0) {
    console.log(`  failures: ${failures.length} (re-run to retry)`);
    for (const f of failures.slice(0, 30)) console.log(`    - ${f.event}: ${f.error}`);
    if (failures.length > 30) console.log(`    ... and ${failures.length - 30} more`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] Fatal:", err);
    process.exit(1);
  });
