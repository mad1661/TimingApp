import { getDb } from "./firebase-admin";
import { normalizeRacerSearch } from "./run-finish";
import { parseTsToDate as parseTsToDateShared, buildTimestampGroups } from "./timestamp-utils";
import {
  categoryKindFor,
  normalizeDesignation,
  fixedComboFor,
  transmissionFromDesignation,
  comboForTrans,
  type CategoryKind,
  type ComboAssignment,
} from "./class-elims";
import {
  computeEtFinalsStandings,
  emptyEtFinalsConfig,
  looseNameKey,
  type EtCategoryRole,
  type EtDivision,
  normalizeCarKey,
  normalizeNameKey,
  type EtTechCardRef,
  type EtFinalsConfig,
  type EtFinalsRoster,
  type EtFinalsStandings,
} from "./et-finals";

// --------------- Types ---------------

export interface RunRow {
  id?: string;
  timestamp: string | null;
  round: string | null;
  qual_pos: number | null;
  car_number: string | null;
  name: string | null;
  class_index: string | null;
  rt: number | null;
  ft60: number | null;
  ft330: number | null;
  ft660: number | null;
  mph_660: number | null;
  ft1000: number | null;
  mph_1000: number | null;
  ft1320: number | null;
  mph_1320: number | null;
  mov: number | null;
  is_winner: number;
  is_dq: number;
  result: string | null;
  place: string | null;
  category: string | null;
  lane: string | null;
  dial_in: number | null;
  event_code: string | null;
  event_name: string | null;
  event_type: string | null;
  season: string | null;
  start_date: string | null;
  // Optional display-only run-number override. When set, overrides the
  // chronological run number computed for the Round Log Print sheet.
  manual_run_number?: number | null;
  // Marker for runs inserted manually via /api/add-pair. When any run in a
  // 4-wide pair has this flag, the print output pads missing lanes.
  manual_entry?: number | null;
  created_at?: string;
  _dedup_key?: string;
  _scrape_seq?: number;
  _phantom?: boolean;
  // Set when `timestamp` already carries a correct AM/PM marker derived from an
  // exact source (the NHRA API's 24-hour `name`). tagRunTimestamps trusts these
  // and skips the strip/re-infer dance it runs on scraper rows (which omit AM/PM).
  _ts_exact?: boolean;
  // Set by upsertRun (the manual edit path). An edited row outranks source rows
  // for the same pass on load, and insertRuns won't overwrite it with re-scraped
  // data — otherwise a manual fix (DQ toggle, corrected RT/dial-in) silently
  // reverts on the next poll or cache reload. Purge & Re-fetch clears edits too.
  _edited?: boolean;
}

export interface EventRow {
  id?: string;
  event_code: string;
  event_type: string;
  event_name: string;
  season: string;
  start_date: string;
  created_at?: string;
}

interface FetchLogEntry {
  event_code: string;
  season: string;
  event_type: string;
  run_count: number;
  fetched_at: string;
}

// --------------- Per-event in-memory cache ---------------
// Each event's runs are loaded independently from its own Firestore sub-collection.
// Max MAX_CACHED_EVENTS kept in memory; least-recently-used is evicted.

interface EventCache {
  runs: RunRow[];
  dedupKeys: Set<string>;
  accessedAt: number;
  loadedAt: number;
}

const _cache = new Map<string, EventCache>();
const _loading = new Map<string, Promise<void>>();
const MAX_CACHED_EVENTS = 3;
// Runs are persisted as array documents (`{ runs: [...] }`) under run_batches.
// Too many RunRows in one document makes the write exceed a Firestore commit
// limit (INVALID_ARGUMENT "Transaction too big"), which bites on a purge + full
// re-fetch of a large national event where every run is new. This is just the
// starting chunk size; writeRunBatch() halves and retries anything Firestore
// still rejects, so correctness doesn't depend on getting this number exactly
// right. Kept modest so most chunks land first-try; smaller docs cost nothing
// on read (the cache loads them all and dedups by key).
const BATCH_SIZE = 50;
// Reload from Firestore at least this often. Required because the cache lives
// per Cloud Run instance — without a TTL, instance B can keep returning a
// snapshot from before instance A's writes for the lifetime of the process.
const CACHE_TTL_MS = 30 * 1000;

function eventKey(eventCode: string, season: string): string {
  return `${eventCode}_${season}`;
}

function collectionPath(eventCode: string, season: string): string {
  return `events_data/${eventKey(eventCode, season)}/run_batches`;
}

function evictIfNeeded(): void {
  if (_cache.size <= MAX_CACHED_EVENTS) return;
  let oldestKey = "";
  let oldestTime = Infinity;
  for (const [key, entry] of _cache) {
    if (entry.accessedAt < oldestTime) {
      oldestTime = entry.accessedAt;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    console.log(`[DB] Evicting cache for ${oldestKey} (${_cache.get(oldestKey)!.runs.length} runs)`);
    _cache.delete(oldestKey);
  }
}

async function ensureEventCache(eventCode: string, season: string): Promise<EventCache> {
  const key = eventKey(eventCode, season);

  const existing = _cache.get(key);
  if (existing && Date.now() - existing.loadedAt < CACHE_TTL_MS) {
    existing.accessedAt = Date.now();
    return existing;
  }
  if (existing) {
    // Stale: drop and reload from Firestore so cross-worker writes are seen.
    _cache.delete(key);
  }

  if (_loading.has(key)) {
    await _loading.get(key);
    return _cache.get(key)!;
  }

  const loadPromise = (async () => {
    try {
      const path = collectionPath(eventCode, season);
      console.log(`[DB] Loading runs for ${key} from Firestore...`);
      const db = getDb();
      const snap = await db.collection(path).get();
      const rawRuns: RunRow[] = [];
      snap.forEach((doc) => {
        const data = doc.data();
        if (Array.isArray(data.runs)) {
          for (const r of data.runs) rawRuns.push(r as RunRow);
        }
      });

      const hasAmPm = (r: RunRow): boolean =>
        !!r.timestamp && /\s+(AM|PM)\s*$/i.test(r.timestamp);
      const dataRichness = (r: RunRow): number => {
        let s = 0;
        // Manual edits outrank source rows outright — without this, an edited
        // run and its superseded original tie, and which one survives the
        // reload depends on Firestore scan order (i.e. the edit randomly
        // reverts).
        if (r._edited) s += 100;
        if (hasTimingData(r)) s += 10;
        if (hasAmPm(r)) s += 1;
        return s;
      };

      const dedupMap = new Map<string, RunRow>();
      for (const run of rawRuns) {
        const dk = dedupKey(run);
        const existing = dedupMap.get(dk);
        if (!existing) {
          dedupMap.set(dk, run);
          continue;
        }
        const a = dataRichness(run);
        const b = dataRichness(existing);
        // Equal richness = the same pass written more than once (updates append
        // new batch docs; old ones aren't deleted). Newest write wins, so
        // changed re-scrapes and edits stick across reloads instead of racing
        // the stale copy in scan order.
        if (a > b || (a === b && (run.created_at || "") > (existing.created_at || ""))) {
          dedupMap.set(dk, run);
        }
      }
      let runs = Array.from(dedupMap.values());

      // Collapse near-duplicate rows of the same physical pass stored under
      // different timestamps/lanes (e.g. a quad's 2nd pairing stored both
      // merged at the 1st pairing's time AND unmerged at its raw +1s time).
      runs = collapseNearDuplicatePasses(runs);

      // Re-stamp _dedup_key on every cached run with the current normalized
      // form so insertRuns recognises freshly scraped rows as matches even if
      // the stored row was written under an older key shape.
      for (const r of runs) {
        r._dedup_key = dedupKey(r);
      }

      backfillNames(runs);

      // Remove reset entries: when the same car_number + round has
      // multiple entries and some lack finish data (ft1320), the ones without
      // finish data are timing-system resets and should be dropped.
      runs = removeResetEntries(runs);

      evictIfNeeded();

      const now = Date.now();
      const entry: EventCache = {
        runs,
        dedupKeys: new Set(runs.map((r) => r._dedup_key).filter(Boolean) as string[]),
        accessedAt: now,
        loadedAt: now,
      };
      _cache.set(key, entry);
      console.log(`[DB] Loaded ${runs.length} runs for ${key} from ${snap.size} batch docs`);
    } catch (err) {
      console.error(`[DB] Failed to load ${key}:`, err);
      _cache.set(key, { runs: [], dedupKeys: new Set(), accessedAt: Date.now(), loadedAt: Date.now() });
    }
    _loading.delete(key);
  })();

  _loading.set(key, loadPromise);
  await loadPromise;
  return _cache.get(key)!;
}

export async function getEventRuns(eventCode: string, season: string): Promise<RunRow[]> {
  const cache = await ensureEventCache(eventCode, season);
  // Mark runs with timestamps clearly in the future as phantoms — but only if
  // they have no timing data. Runs WITH timing data are real runs that the
  // NHRA system gave bogus timestamps (quad second-pairs). Those get fixed by
  // the scraper's quad correction, not hidden. Use a 24h cushion so timezone
  // skew between the server and the track can't accidentally hide today's
  // morning runs.
  const cutoff = Date.now() + 24 * 60 * 60 * 1000;
  for (const r of cache.runs) {
    if (r._phantom) continue;
    if (!r.timestamp) continue;
    const d = parseTsToDateShared(r.timestamp);
    if (d && d.getTime() > cutoff) {
      const hasData = r.rt != null || r.ft1320 != null || r.ft660 != null || r.ft60 != null;
      if (!hasData) r._phantom = true;
    }
  }
  return cache.runs.filter((r) => !r._phantom);
}

// --------------- Dedup ---------------

// Canonicalize the lane so the same physical lane dedupes regardless of how the
// source labels it: the getresults grid uses "1"/"2" (or "L1"/"L2"), while the
// API uses left/right. Without this, an API row and a scraper row for the same
// run produce different dedup keys, so the run shows twice — and a 2-wide pair
// then renders as a bogus 4-wide. Mirrors normalLane()'s recognized vocabulary.
function laneKey(lane: string | null | undefined): string {
  const v = (lane || "").trim().toUpperCase();
  if (v === "L" || v === "L1" || v === "1" || v === "LEFT") return "1";
  if (v === "R" || v === "L2" || v === "2" || v === "RIGHT") return "2";
  if (v === "L3" || v === "3") return "3";
  if (v === "L4" || v === "4") return "4";
  return v;
}

function dedupKey(run: Omit<RunRow, "id" | "created_at" | "_dedup_key">): string {
  // Canonicalize every component so the SAME physical run dedupes no matter how
  // each source formats it. The getresults scraper and the API serialize things
  // differently — the timestamp (AM/PM marker, leading zeros, 12h vs 24h), the
  // lane ("L"/"R" vs "Left"/"Right"), and car/round casing/whitespace — so
  // without normalizing here, an API row and a scraper row for the same pass
  // land as two rows. The timestamp is parsed to a canonical YYYYMMDDhhMMSS;
  // if it can't be parsed we fall back to the AM/PM-stripped string.
  //
  // The hour is taken MODULO 12 so the AM/PM marker does not contribute to a
  // run's identity. The marker on scraper rows is *inferred* (inferAmPm /
  // tagRunTimestamps walk the day's runs), and the inference for ambiguous
  // hours (6-11) can flip between scrapes as the day's grid grows — e.g. an
  // evening session first seen starting at hour 8 tags AM, then a later scrape
  // that includes earlier runs tags the same rows PM. If the marker were part
  // of the key, each flip would mint new identities 12 hours apart (far outside
  // the same-pass guard's window) and store the whole session twice. A car
  // can't make two passes in the same round+lane at the same 12-hour clock
  // second, so dropping the marker is safe — and 24-hour API times still
  // collapse with 12-hour scraper times (21:04 % 12 == 9:04).
  const d = parseTsToDateShared(run.timestamp || "");
  const p = (n: number) => String(n).padStart(2, "0");
  const ts = d
    ? `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours() % 12)}${p(d.getMinutes())}${p(d.getSeconds())}`
    : (run.timestamp || "").replace(/\s+(AM|PM)\s*$/i, "").trim();
  const car = (run.car_number || "").trim().toUpperCase();
  const round = (run.round || "").trim().toUpperCase();
  return `${ts}|${car}|${round}|${laneKey(run.lane)}|${run.event_code}|${run.season}`;
}

/**
 * Rewrite a persisted dedup key to the current (12-hour) shape. Keys saved
 * while dedupKey() encoded the hour in 24-hour form (e.g. in ignored_runs
 * docs) carry HH 12-23 in the leading YYYYMMDDHHMMSS block; live keys now use
 * HH % 12. Without this, previously ignored afternoon runs would reappear.
 * Keys that don't start with a 14-digit timestamp pass through unchanged.
 */
export function normalizeDedupKey(key: string): string {
  const m = key.match(/^(\d{8})(\d{2})(\d{4})\|/);
  if (!m) return key;
  const hour = parseInt(m[2], 10);
  if (hour < 12 || hour > 23) return key;
  const h12 = String(hour % 12).padStart(2, "0");
  return `${m[1]}${h12}${m[3]}${key.slice(14)}`;
}

function hasTimingData(run: RunRow | Omit<RunRow, "id" | "created_at" | "_dedup_key">): boolean {
  return run.rt != null || run.ft1320 != null || run.ft660 != null || run.ft60 != null;
}

// --------------- Near-duplicate pass collapse (4-wide killer) ---------------
//
// The same physical pass can be stored under DIFFERENT dedup keys when sources
// disagree about its timestamp or lane. The classic case is the 2nd pairing of
// a 4-wide quad: the API merge aligns it to the 1st pairing's timestamp with
// lanes 3/4, while an unmerged fetch (getresults, or an older code version)
// stores it at its raw +1s timestamp with lanes 1/2. Result: six rows for a
// four-car quad, clashing lane numbers, and broken 4-wide views.
//
// A car cannot make two passes in the same round within a few seconds, so rows
// for the same car+round+category whose timestamps fall within this window are
// the same pass and must collapse to one.
const SAME_PASS_TOLERANCE_MS = 10_000;

function passKey(run: RunRow | Omit<RunRow, "id" | "created_at" | "_dedup_key">): string | null {
  const car = (run.car_number || "").trim().toUpperCase();
  if (!car) return null; // empty bye/ghost lanes can't be matched safely
  const round = (run.round || "").trim().toUpperCase();
  return `${car}|${round}|${run.category || ""}|${run.event_code}|${run.season}`;
}

function passTimeMs(run: RunRow | Omit<RunRow, "id" | "created_at" | "_dedup_key">): number | null {
  const d = parseTsToDateShared(run.timestamp || "");
  return d ? d.getTime() : null;
}

// Which copy of the same pass survives a collapse. Manual edits and manual
// entries always win; then the API's exact-timestamp version (it carries the
// merged quad lanes 3/4); then whichever actually has timing data; then the
// newest write.
function passPreference(r: RunRow): number {
  let s = 0;
  if (r._edited) s += 1000;
  if (r.manual_entry) s += 500;
  if (r._ts_exact) s += 100;
  if (hasTimingData(r)) s += 10;
  return s;
}

function collapseNearDuplicatePasses(runs: RunRow[]): RunRow[] {
  const byPass = new Map<string, RunRow[]>();
  const out: RunRow[] = [];
  for (const r of runs) {
    const key = passKey(r);
    const t = passTimeMs(r);
    if (!key || t == null) {
      out.push(r);
      continue;
    }
    const arr = byPass.get(key) || [];
    arr.push(r);
    byPass.set(key, arr);
  }

  let collapsed = 0;
  for (const group of byPass.values()) {
    group.sort((a, b) => passTimeMs(a)! - passTimeMs(b)!);
    let cluster: RunRow[] = [];
    let clusterStart = -Infinity;
    const flush = () => {
      if (cluster.length === 0) return;
      cluster.sort(
        (a, b) =>
          passPreference(b) - passPreference(a) ||
          (b.created_at || "").localeCompare(a.created_at || ""),
      );
      out.push(cluster[0]);
      collapsed += cluster.length - 1;
    };
    for (const r of group) {
      const t = passTimeMs(r)!;
      if (cluster.length > 0 && t - clusterStart <= SAME_PASS_TOLERANCE_MS) {
        cluster.push(r);
      } else {
        flush();
        cluster = [r];
        clusterStart = t;
      }
    }
    flush();
  }

  if (collapsed > 0) {
    console.log(`[DB] Collapsed ${collapsed} near-duplicate pass rows`);
  }
  return out;
}

/**
 * Remove timing-system reset entries. When the same car_number + name + round
 * appears more than once and some entries have no finish time (ft1320), the
 * entries without finish data are likely resets and should be removed.
 * Also removes the opponent(s) from the same reset timestamp so the schedule
 * pair count stays accurate.
 * Only drops entries when a completed run exists for the same car/name/round.
 */
function removeResetEntries(runs: RunRow[]): RunRow[] {
  // Group by name + category + round + event_code + season
  // Use name (after backfill) as primary grouping since car_number may be missing on resets.
  // Also group by car_number as fallback for runs without names.
  const groups = new Map<string, RunRow[]>();
  for (const run of runs) {
    // Try name first (more reliable after backfill), fall back to car_number
    const id = (run.name || "").trim().toUpperCase() || (run.car_number || "").trim();
    if (!id) continue;
    const gk = `${id}|${(run.category || "")}|${run.round}|${run.event_code}|${run.season}`;
    let arr = groups.get(gk);
    if (!arr) { arr = []; groups.set(gk, arr); }
    arr.push(run);
  }

  // Collect timestamps of reset entries so we can also remove opponents
  const removals = new Set<RunRow>();
  const resetTimestamps = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const withFinish = group.filter((r) => r.ft1320 != null && r.ft1320 > 0);
    const withoutFinish = group.filter((r) => r.ft1320 == null || r.ft1320 === 0);
    // Only remove incomplete entries if at least one completed entry exists
    if (withFinish.length > 0 && withoutFinish.length > 0) {
      for (const r of withoutFinish) {
        removals.add(r);
        // Track this timestamp + category + round so we remove the whole pair
        if (r.timestamp) {
          resetTimestamps.add(`${r.timestamp}|${r.category}|${r.round}|${r.event_code}|${r.season}`);
        }
      }
    }
  }

  // Also remove opponents from the same reset timestamp (the other lane)
  if (resetTimestamps.size > 0) {
    for (const run of runs) {
      if (removals.has(run)) continue;
      const tsKey = `${run.timestamp}|${run.category}|${run.round}|${run.event_code}|${run.season}`;
      if (resetTimestamps.has(tsKey)) {
        removals.add(run);
      }
    }
  }

  if (removals.size > 0) {
    console.log(`[DB] Removed ${removals.size} reset entries + opponents (no finish data where completed run exists)`);
    return runs.filter((r) => !removals.has(r));
  }
  return runs;
}

// --------------- Cache invalidation ---------------

/**
 * Drop the in-memory cache for an event so the next read reloads from
 * Firestore. Useful when another worker/process may have written runs that
 * this worker hasn't observed yet, e.g. after a public-share refresh.
 */
export function invalidateEventCache(eventCode: string, season: string): void {
  const key = eventKey(eventCode, season);
  _cache.delete(key);
  _loading.delete(key);
}

// --------------- Purge & Re-fetch ---------------

export async function purgeEventRuns(eventCode: string, season: string): Promise<number> {
  const key = eventKey(eventCode, season);
  const path = collectionPath(eventCode, season);
  const db = getDb();

  const snap = await db.collection(path).get();
  let deleted = 0;
  const batchSize = 400;
  const docs = snap.docs;

  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + batchSize);
    for (const doc of chunk) {
      batch.delete(doc.ref);
      deleted++;
    }
    await batch.commit();
  }

  _cache.delete(key);
  _loading.delete(key);

  console.log(`[DB] Purged ${deleted} batch docs for ${key}`);
  return deleted;
}

// --------------- Write operations ---------------

// Tracks events we've already verified or inserted this process so repeated
// polling doesn't re-query Firestore on every refresh.
const _knownEvents = new Set<string>();

export async function insertEvent(event: Omit<EventRow, "id" | "created_at">): Promise<void> {
  const key = eventKey(event.event_code, event.season);
  if (_knownEvents.has(key)) return;
  try {
    const db = getDb();
    const existing = await db.collection("events")
      .where("event_code", "==", event.event_code)
      .where("season", "==", event.season)
      .limit(1)
      .get();

    if (existing.empty) {
      await db.collection("events").add({
        ...event,
        created_at: new Date().toISOString(),
      });
    }
    _knownEvents.add(key);
  } catch (err) {
    console.error("[DB] insertEvent error:", err);
  }
}

export async function insertRuns(
  eventCode: string,
  season: string,
  runs: Omit<RunRow, "id" | "created_at" | "_dedup_key">[]
): Promise<number> {
  if (runs.length === 0) return 0;

  const cache = await ensureEventCache(eventCode, season);

  const newRuns: RunRow[] = [];
  for (const run of runs) {
    const key = dedupKey(run);

    if (cache.dedupKeys.has(key)) {
      const existingIdx = cache.runs.findIndex((r) => r._dedup_key === key);
      if (existingIdx !== -1) {
        const existing = cache.runs[existingIdx];

        // A manually edited row is authoritative until the event is purged —
        // re-scraped source data must not overwrite it, or the edit reverts on
        // the very next poll.
        if (existing._edited) {
          if (run._scrape_seq != null) existing._scrape_seq = run._scrape_seq;
          continue;
        }

        const changed = run.rt !== existing.rt || run.ft1320 !== existing.ft1320 ||
          run.ft660 !== existing.ft660 || run.ft60 !== existing.ft60 ||
          run.ft330 !== existing.ft330 || run.ft1000 !== existing.ft1000 ||
          run.mph_660 !== existing.mph_660 || run.mph_1000 !== existing.mph_1000 ||
          run.mph_1320 !== existing.mph_1320 || run.is_winner !== existing.is_winner ||
          run.dial_in !== existing.dial_in || run.qual_pos !== existing.qual_pos ||
          run.result !== existing.result || (!existing.name && run.name) ||
          run.timestamp !== existing.timestamp;
        if (!changed) {
          if (run._scrape_seq != null && existingIdx !== -1) {
            cache.runs[existingIdx]._scrape_seq = run._scrape_seq;
          }
          continue;
        }
      }

      const wasPhantom = existingIdx !== -1 && cache.runs[existingIdx]._phantom;
      const row: RunRow = {
        ...run,
        _dedup_key: key,
        _phantom: wasPhantom || false,
        created_at: new Date().toISOString(),
      };
      if (existingIdx !== -1) cache.runs[existingIdx] = row;
      newRuns.push(row);
      continue;
    }

    // Same-pass guard: the dedup key is new, but the row may still be the same
    // physical pass as one we already hold under a different timestamp/lane
    // (quad 2nd-pairing merged vs unmerged, API vs getresults). Never store
    // both — keep whichever version is preferred.
    const pk = passKey(run);
    const t = passTimeMs(run);
    if (pk && t != null) {
      const nearIdx = cache.runs.findIndex((r) => {
        if (passKey(r) !== pk) return false;
        const rt2 = passTimeMs(r);
        return rt2 != null && Math.abs(rt2 - t) <= SAME_PASS_TOLERANCE_MS;
      });
      if (nearIdx !== -1) {
        const near = cache.runs[nearIdx];
        if (near._edited || passPreference(near) >= passPreference(run as RunRow)) {
          // Existing copy wins (ties keep the stored row so polls don't
          // flip-flop between sources). Just refresh its walk position.
          if (run._scrape_seq != null) near._scrape_seq = run._scrape_seq;
          continue;
        }
        // Incoming copy wins (e.g. API-merged quad lanes replacing an
        // unmerged getresults pair) — swap it in under its new key.
        const replacement: RunRow = {
          ...run,
          _dedup_key: key,
          _phantom: near._phantom || false,
          created_at: new Date().toISOString(),
        };
        if (near._dedup_key) cache.dedupKeys.delete(near._dedup_key);
        cache.runs[nearIdx] = replacement;
        cache.dedupKeys.add(key);
        newRuns.push(replacement);
        continue;
      }
    }

    const row: RunRow = {
      ...run,
      _dedup_key: key,
      created_at: new Date().toISOString(),
    };
    newRuns.push(row);
    cache.runs.push(row);
    cache.dedupKeys.add(key);
  }

  if (newRuns.length === 0) return 0;

  const db = getDb();
  const path = collectionPath(eventCode, season);
  for (let i = 0; i < newRuns.length; i += BATCH_SIZE) {
    await writeRunBatch(db, path, newRuns.slice(i, i + BATCH_SIZE));
  }

  backfillNames(cache.runs);

  console.log(`[DB] Inserted ${newRuns.length} new runs for ${eventKey(eventCode, season)} — ${cache.runs.length} total cached`);
  return newRuns.length;
}

// Persist one run_batches document (an array of RunRows). Firestore caps how
// much a single commit can carry, and a big event's array can exceed it —
// surfacing as INVALID_ARGUMENT "Transaction too big. Decrease transaction
// size." Rather than guess a safe fixed count (which varies with how wide the
// rows are), write the chunk and, if Firestore rejects it for size, halve it
// and retry each half — recursing until every piece fits. A single run always
// fits, so this terminates and any event persists no matter how large.
async function writeRunBatch(
  db: ReturnType<typeof getDb>,
  path: string,
  chunk: RunRow[],
): Promise<void> {
  try {
    await db.collection(path).add({
      runs: chunk.map((r) => ({ ...r })),
      count: chunk.length,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const tooBig =
      (err as { code?: number } | null)?.code === 3 || // gRPC INVALID_ARGUMENT
      /too big|INVALID_ARGUMENT/i.test(msg);
    if (chunk.length > 1 && tooBig) {
      const mid = Math.ceil(chunk.length / 2);
      await writeRunBatch(db, path, chunk.slice(0, mid));
      await writeRunBatch(db, path, chunk.slice(mid));
      return;
    }
    throw err;
  }
}

/**
 * Force-write a run: always persists, even when the change detector in insertRuns
 * would skip the write (e.g. toggling is_dq / changing class_index / fixing a name).
 * If the dedup_key changes, the caller should separately add the old key to the
 * ignored list so the original entry disappears from views.
 */
export async function upsertRun(
  eventCode: string,
  season: string,
  run: Omit<RunRow, "id" | "created_at" | "_dedup_key">
): Promise<void> {
  const cache = await ensureEventCache(eventCode, season);
  const key = dedupKey(run);
  const row: RunRow = {
    ...run,
    _dedup_key: key,
    // Manual edits are authoritative: outrank source copies on load and block
    // insertRuns from overwriting with re-scraped data (see RunRow._edited).
    _edited: true,
    created_at: new Date().toISOString(),
  };

  const existingIdx = cache.runs.findIndex((r) => r._dedup_key === key);
  if (existingIdx !== -1) {
    cache.runs[existingIdx] = row;
  } else {
    cache.runs.push(row);
    cache.dedupKeys.add(key);
  }

  const db = getDb();
  const path = collectionPath(eventCode, season);
  await db.collection(path).add({
    runs: [row],
    count: 1,
    created_at: new Date().toISOString(),
  });

  backfillNames(cache.runs);
  console.log(`[DB] Upserted run ${key}`);
}

function backfillNames(runs: RunRow[]): void {
  const nameMap = new Map<string, string>();
  for (const run of runs) {
    if (!run.name || !run.car_number || !run.category) continue;
    const key = `${run.car_number.trim()}|||${run.category}`;
    if (!nameMap.has(key)) nameMap.set(key, run.name);
  }

  for (const run of runs) {
    if (run.name || !run.car_number || !run.category) continue;
    const key = `${run.car_number.trim()}|||${run.category}`;
    const name = nameMap.get(key);
    if (name) run.name = name;
  }
}

export async function logFetch(eventCode: string, season: string, eventType: string, runCount: number): Promise<void> {
  try {
    const db = getDb();
    await db.collection("fetch_log").add({
      event_code: eventCode,
      season,
      event_type: eventType,
      run_count: runCount,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[DB] logFetch error:", err);
  }
}

// --------------- Query operations ---------------

export interface RunsQuery {
  category?: string;
  name?: string;
  car_number?: string;
  event_code: string;
  season: string;
  round?: string;
  class_index?: string;
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_dir?: "ASC" | "DESC";
}

export async function queryRuns(q: RunsQuery): Promise<{ runs: RunRow[]; total: number }> {
  let runs = await getEventRuns(q.event_code, q.season);
  tagRunTimestamps(runs);

  if (q.category) runs = runs.filter((r) => r.category === q.category);
  if (q.round) runs = runs.filter((r) => r.round === q.round);
  if (q.class_index) runs = runs.filter((r) => r.class_index === q.class_index);
  if (q.car_number) {
    runs = runs.filter((r) => r.car_number === q.car_number);
  }
  if (q.name) {
    const search = q.name.toLowerCase();
    runs = runs.filter((r) => r.name?.toLowerCase().includes(search));
  }

  const total = runs.length;

  const sortField = (q.sort_by || "timestamp") as keyof RunRow;
  const dir = q.sort_dir === "ASC" ? 1 : -1;
  runs = [...runs].sort((a, b) => {
    const va = a[sortField];
    const vb = b[sortField];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    if (sortField === "timestamp") {
      const da = parseTsToDate(String(va));
      const db = parseTsToDate(String(vb));
      if (da && db) return (da.getTime() - db.getTime()) * dir;
    }
    return String(va).localeCompare(String(vb)) * dir;
  });

  const offset = q.offset || 0;
  const limit = Math.min(q.limit || 100, 1000);
  runs = runs.slice(offset, offset + limit);

  return { runs, total };
}

export async function getCategories(eventCode: string, season: string): Promise<string[]> {
  const cats = new Set<string>();
  (await getEventRuns(eventCode, season)).forEach((r) => { if (r.category) cats.add(r.category); });
  return Array.from(cats).sort();
}

export function roundSortKey(r: string): number {
  const type = r.charAt(0).toUpperCase();
  const num = parseInt(r.slice(1), 10) || 0;
  if (type === "E") return 1000 - num;
  if (type === "Q") return 2000 - num;
  if (type === "T") return 3000 - num;
  if (r === "F" || r.toLowerCase() === "final") return 500;
  return 4000;
}

export async function getDistinctRounds(eventCode: string, season: string): Promise<string[]> {
  const rounds = new Set<string>();
  (await getEventRuns(eventCode, season)).forEach((r) => { if (r.round) rounds.add(r.round); });
  return Array.from(rounds).sort((a, b) => roundSortKey(a) - roundSortKey(b));
}

export async function getDistinctClasses(eventCode: string, season: string): Promise<string[]> {
  const classes = new Set<string>();
  (await getEventRuns(eventCode, season)).forEach((r) => { if (r.class_index) classes.add(r.class_index); });
  return Array.from(classes).sort();
}

export async function getEvents(): Promise<EventRow[]> {
  try {
    const db = getDb();
    const snap = await db.collection("events").get();
    const events: EventRow[] = [];
    snap.forEach((doc) => {
      events.push({ id: doc.id, ...doc.data() } as EventRow);
    });
    return events.sort((a, b) => b.season.localeCompare(a.season));
  } catch {
    return [];
  }
}

export async function searchRacers(search: string, eventCode: string, season: string): Promise<{ name: string; car_number: string; category: string }[]> {
  return collectRacerMatches(search, await getEventRuns(eventCode, season));
}

export async function searchRacersAllEvents(search: string): Promise<{ name: string; car_number: string; category: string }[]> {
  const events = await getEvents();
  const runs: RunRow[] = [];
  for (const ev of events) {
    runs.push(...await getEventRuns(ev.event_code, ev.season));
  }
  return collectRacerMatches(search, runs);
}

function collectRacerMatches(
  search: string,
  runs: RunRow[],
): { name: string; car_number: string; category: string }[] {
  const s = normalizeRacerSearch(search);
  if (!s) return [];
  const seen = new Map<string, string>();
  for (const r of runs) {
    const name = (r.name || "").trim();
    const car = (r.car_number || "").trim();
    if (!name && !car) continue;
    const nameHit = name.toLowerCase().includes(s);
    const carHit = car.toLowerCase().includes(s);
    if (!nameHit && !carHit) continue;
    const key = `${name}|||${car}`;
    if (!seen.has(key)) seen.set(key, r.category || "");
  }
  return Array.from(seen.entries())
    .map(([key, category]) => {
      const [name, car_number] = key.split("|||");
      return { name, car_number, category };
    })
    .sort((a, b) => a.car_number.localeCompare(b.car_number) || a.name.localeCompare(b.name))
    .slice(0, 50);
}

export async function getRacerRuns(name: string, eventCode: string, season: string): Promise<RunRow[]> {
  const wanted = (name || "").trim();
  if (!wanted) return [];
  const runs = await getEventRuns(eventCode, season);
  tagRunTimestamps(runs);
  return runs
    .filter((r) => (r.name || "").trim() === wanted)
    .sort((a, b) => tsSortKey(b.timestamp || "").localeCompare(tsSortKey(a.timestamp || "")));
}

export async function getCarNumberRuns(carNumber: string, eventCode: string, season: string): Promise<RunRow[]> {
  const runs = await getEventRuns(eventCode, season);
  tagRunTimestamps(runs);
  const cn = carNumber.trim().toLowerCase();
  return runs
    .filter((r) => {
      if (!r.car_number) return false;
      const stored = r.car_number.trim().toLowerCase();
      return stored === cn || stored.includes(cn) || cn.includes(stored);
    })
    .sort((a, b) => tsSortKey(b.timestamp || "").localeCompare(tsSortKey(a.timestamp || "")));
}

export async function getRacerRunsAllEvents(name: string, excludeEventCode?: string, excludeSeason?: string): Promise<RunRow[]> {
  const events = await getEvents();
  const allRuns: RunRow[] = [];
  for (const ev of events) {
    if (excludeEventCode && excludeSeason && ev.event_code === excludeEventCode && ev.season === excludeSeason) continue;
    const runs = await getEventRuns(ev.event_code, ev.season);
    tagRunTimestamps(runs);
    for (const r of runs) {
      if (r.name === name) {
        allRuns.push(r);
      }
    }
  }
  return allRuns.sort((a, b) => tsSortKey(b.timestamp || "").localeCompare(tsSortKey(a.timestamp || "")));
}

export async function getCarNumberRunsAllEvents(carNumber: string): Promise<RunRow[]> {
  const events = await getEvents();
  const allRuns: RunRow[] = [];
  const cn = carNumber.trim().toLowerCase();
  for (const ev of events) {
    const runs = await getEventRuns(ev.event_code, ev.season);
    tagRunTimestamps(runs);
    for (const r of runs) {
      if (!r.car_number) continue;
      const stored = r.car_number.trim().toLowerCase();
      if (stored === cn || stored.includes(cn) || cn.includes(stored)) {
        allRuns.push(r);
      }
    }
  }
  return allRuns.sort((a, b) => tsSortKey(b.timestamp || "").localeCompare(tsSortKey(a.timestamp || "")));
}

export interface DashboardStats {
  totalRuns: number;
  uniqueRacers: number;
  totalEvents: number;
  seasons: number;
  bestET: RunRow | null;
  bestRT: RunRow | null;
  fastestSpeed: RunRow | null;
  recentRuns: RunRow[];
}

export async function getDashboardStats(eventCode: string, season: string): Promise<DashboardStats> {
  const allRuns = await getEventRuns(eventCode, season);

  const validRuns = allRuns.filter((r) => r.name && r.name !== "");
  const racers = new Set(validRuns.map((r) => r.name));

  let bestET: RunRow | null = null;
  let bestRT: RunRow | null = null;
  let fastestSpeed: RunRow | null = null;

  for (const r of validRuns) {
    if (r.ft1320 && r.ft1320 > 0 && (!bestET || r.ft1320 < bestET.ft1320!)) bestET = r;
    if (r.rt && r.rt > 0 && (!bestRT || r.rt < bestRT.rt!)) bestRT = r;
    if (r.mph_1320 && r.mph_1320 > 0 && (!fastestSpeed || r.mph_1320 > fastestSpeed.mph_1320!)) fastestSpeed = r;
  }

  tagRunTimestamps(validRuns);
  const recentRuns = [...validRuns]
    .sort((a, b) => tsSortKey(b.timestamp || "").localeCompare(tsSortKey(a.timestamp || "")))
    .slice(0, 20);

  return {
    totalRuns: allRuns.length,
    uniqueRacers: racers.size,
    totalEvents: 1,
    seasons: 1,
    bestET,
    bestRT,
    fastestSpeed,
    recentRuns,
  };
}

export async function getCategoryStats(eventCode: string, season: string): Promise<{ category: string; count: number; bestET: number | null; avgRT: number | null; bestSpeed: number | null }[]> {
  const byCategory = new Map<string, RunRow[]>();

  const runs = await getEventRuns(eventCode, season);

  runs.forEach((run) => {
    if (!run.category) return;
    const arr = byCategory.get(run.category) || [];
    arr.push(run);
    byCategory.set(run.category, arr);
  });

  return Array.from(byCategory.entries())
    .map(([category, catRuns]) => {
      const ets = catRuns.map((r) => r.ft1320).filter((v): v is number => v !== null && v > 0);
      const rts = catRuns.map((r) => r.rt).filter((v): v is number => v !== null && v > 0);
      const speeds = catRuns.map((r) => r.mph_1320).filter((v): v is number => v !== null && v > 0);

      return {
        category,
        count: catRuns.length,
        bestET: ets.length > 0 ? Math.min(...ets) : null,
        avgRT: rts.length > 0 ? rts.reduce((a, b) => a + b, 0) / rts.length : null,
        bestSpeed: speeds.length > 0 ? Math.max(...speeds) : null,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category));
}

export interface HeadsUpCategoryStat {
  category: string;
  type: "headsup";
  count: number;
  bestET: number | null;
  bestSpeed: number | null;
  best60ft: number | null;
  best330: number | null;
  best660: number | null;
  best660mph: number | null;
  best1000: number | null;
  avgRT: number | null;
  bestRT: number | null;
}

export interface BracketCategoryStat {
  category: string;
  type: "bracket";
  count: number;
  avgRT: number | null;
  bestRT: number | null;
  avgPackage: number | null;
  bestPackage: number | null;
  avgDialDeviation: number | null;
  etStdDev: number | null;
  breakoutRate: number | null;
  breakoutCount: number;
  winCount: number;
  lossCount: number;
  bestET: number | null;
  bestSpeed: number | null;
}

export type DetailedCategoryStat = HeadsUpCategoryStat | BracketCategoryStat;

export async function getDetailedCategoryStats(eventCode: string, season: string): Promise<DetailedCategoryStat[]> {
  const byCategory = new Map<string, RunRow[]>();
  const runs = await getEventRuns(eventCode, season);

  runs.forEach((run) => {
    if (!run.category) return;
    const arr = byCategory.get(run.category) || [];
    arr.push(run);
    byCategory.set(run.category, arr);
  });

  return Array.from(byCategory.entries())
    .map(([category, catRuns]): DetailedCategoryStat => {
      // Determine if bracket category: majority of elimination runs have dial_in set
      const elimRuns = catRuns.filter((r) => r.round && r.round.startsWith("E"));
      const dialCount = elimRuns.filter((r) => r.dial_in !== null && r.dial_in > 0).length;
      const isBracket = elimRuns.length > 0 && dialCount / elimRuns.length > 0.5;

      const ets = catRuns.map((r) => r.ft1320).filter((v): v is number => v !== null && v > 0);
      const rts = catRuns.map((r) => r.rt).filter((v): v is number => v !== null && v > 0);
      const speeds = catRuns.map((r) => r.mph_1320).filter((v): v is number => v !== null && v > 0);

      if (isBracket) {
        // Package = RT + (ET - dial_in), only for runs with valid data
        const packageRuns = catRuns.filter(
          (r) => r.rt !== null && r.rt > 0 && r.ft1320 !== null && r.ft1320 > 0 && r.dial_in !== null && r.dial_in > 0
        );
        const packages = packageRuns.map((r) => r.rt! + (r.ft1320! - r.dial_in!));
        const dialDeviations = packageRuns.map((r) => r.ft1320! - r.dial_in!);
        const breakouts = packageRuns.filter((r) => r.ft1320! < r.dial_in!);

        // ET standard deviation
        let etStdDev: number | null = null;
        if (ets.length > 1) {
          const mean = ets.reduce((a, b) => a + b, 0) / ets.length;
          const variance = ets.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (ets.length - 1);
          etStdDev = Math.sqrt(variance);
        }

        return {
          category,
          type: "bracket",
          count: catRuns.length,
          avgRT: rts.length > 0 ? rts.reduce((a, b) => a + b, 0) / rts.length : null,
          bestRT: rts.length > 0 ? Math.min(...rts) : null,
          avgPackage: packages.length > 0 ? packages.reduce((a, b) => a + b, 0) / packages.length : null,
          bestPackage: packages.length > 0 ? Math.min(...packages) : null,
          avgDialDeviation: dialDeviations.length > 0 ? dialDeviations.reduce((a, b) => a + b, 0) / dialDeviations.length : null,
          etStdDev,
          breakoutRate: packageRuns.length > 0 ? breakouts.length / packageRuns.length : null,
          breakoutCount: breakouts.length,
          winCount: catRuns.filter((r) => r.is_winner === 1).length,
          lossCount: catRuns.filter((r) => r.is_winner === 0 && r.round && r.round.startsWith("E")).length,
          bestET: ets.length > 0 ? Math.min(...ets) : null,
          bestSpeed: speeds.length > 0 ? Math.max(...speeds) : null,
        };
      } else {
        const ft60s = catRuns.map((r) => r.ft60).filter((v): v is number => v !== null && v > 0);
        const ft330s = catRuns.map((r) => r.ft330).filter((v): v is number => v !== null && v > 0);
        const ft660s = catRuns.map((r) => r.ft660).filter((v): v is number => v !== null && v > 0);
        const mph660s = catRuns.map((r) => r.mph_660).filter((v): v is number => v !== null && v > 0);
        const ft1000s = catRuns.map((r) => r.ft1000).filter((v): v is number => v !== null && v > 0);

        return {
          category,
          type: "headsup",
          count: catRuns.length,
          bestET: ets.length > 0 ? Math.min(...ets) : null,
          bestSpeed: speeds.length > 0 ? Math.max(...speeds) : null,
          best60ft: ft60s.length > 0 ? Math.min(...ft60s) : null,
          best330: ft330s.length > 0 ? Math.min(...ft330s) : null,
          best660: ft660s.length > 0 ? Math.min(...ft660s) : null,
          best660mph: mph660s.length > 0 ? Math.max(...mph660s) : null,
          best1000: ft1000s.length > 0 ? Math.min(...ft1000s) : null,
          avgRT: rts.length > 0 ? rts.reduce((a, b) => a + b, 0) / rts.length : null,
          bestRT: rts.length > 0 ? Math.min(...rts) : null,
        };
      }
    })
    .sort((a, b) => a.category.localeCompare(b.category));
}

export async function getEliminationRuns(eventCode: string, season: string, category: string): Promise<RunRow[]> {
  const allRuns = await getEventRuns(eventCode, season);
  tagRunTimestamps(allRuns);
  return allRuns
    .filter((r) => r.category === category && r.round?.startsWith("E"))
    .sort((a, b) => {
      const roundCmp = (a.round || "").localeCompare(b.round || "");
      if (roundCmp !== 0) return roundCmp;
      return tsSortKey(a.timestamp || "").localeCompare(tsSortKey(b.timestamp || ""));
    });
}

export interface NoShow {
  name: string;
  car_number: string;
  category: string;
  wonRound: string;
  missedRound: string;
}

export function detectNoShows(elimRuns: RunRow[], category?: string): NoShow[] {
  const rounds = [...new Set(elimRuns.map((r) => r.round).filter(Boolean))]
    .sort() as string[];

  if (rounds.length < 2) return [];

  const cat = category || elimRuns[0]?.category || "";
  const noShows: NoShow[] = [];

  for (let i = 0; i < rounds.length - 1; i++) {
    const currentRound = rounds[i];
    const nextRound = rounds[i + 1];

    const currentRuns = elimRuns.filter((r) => r.round === currentRound);
    const nextRuns = elimRuns.filter((r) => r.round === nextRound);

    if (nextRuns.length === 0) continue;

    const winners = currentRuns.filter((r) => r.is_winner === 1);
    const nextRoundNumbers = new Set(
      nextRuns.map((r) => r.car_number?.trim()).filter(Boolean)
    );

    for (const winner of winners) {
      if (!winner.car_number) continue;
      if (!nextRoundNumbers.has(winner.car_number.trim())) {
        noShows.push({
          name: winner.name || "",
          car_number: winner.car_number,
          category: cat,
          wonRound: currentRound,
          missedRound: nextRound,
        });
      }
    }
  }

  return noShows;
}

export interface NoShowResult {
  noShows: NoShow[];
  activeCategory: string | null;
}

export async function getAllNoShows(eventCode: string, season: string): Promise<NoShowResult> {
  const allRuns = await getEventRuns(eventCode, season);
  const elimRuns = allRuns.filter((r) => r.round?.startsWith("E"));

  const categories = [...new Set(elimRuns.map((r) => r.category).filter(Boolean))] as string[];
  const allNoShows: NoShow[] = [];

  let activeCategory: string | null = null;
  let latestTime = 0;

  for (const cat of categories) {
    const catRuns = elimRuns
      .filter((r) => r.category === cat)
      .sort((a, b) => {
        const roundCmp = (a.round || "").localeCompare(b.round || "");
        if (roundCmp !== 0) return roundCmp;
        return (a.timestamp || "").localeCompare(b.timestamp || "");
      });
    allNoShows.push(...detectNoShows(catRuns, cat));

    for (const run of catRuns) {
      if (!run.timestamp) continue;
      const d = parseTsToDate(run.timestamp);
      if (d && d.getTime() > latestTime) {
        latestTime = d.getTime();
        activeCategory = cat;
      }
    }
  }

  const sorted = allNoShows.sort((a, b) => a.category.localeCompare(b.category) || a.missedRound.localeCompare(b.missedRound));
  return { noShows: sorted, activeCategory };
}

export interface DidNotRace {
  name: string;
  car_number: string;
  category: string;
  lastRound: string;
}

export async function getDidNotRace(eventCode: string, season: string): Promise<DidNotRace[]> {
  const allRuns = await getEventRuns(eventCode, season);

  const elimCarNumbers = new Map<string, Set<string>>();
  const qualifiers = new Map<string, Map<string, { name: string; lastRound: string }>>();

  for (const run of allRuns) {
    if (!run.car_number || !run.category || !run.round) continue;
    const carNum = run.car_number.trim();

    if (run.round.startsWith("E")) {
      elimCarNumbers.set(run.category, (elimCarNumbers.get(run.category) || new Set()).add(carNum));
    } else if (run.round.startsWith("Q") || run.round.startsWith("T")) {
      const catMap = qualifiers.get(run.category) || new Map();
      const key = `${carNum}|||${run.category}`;
      const existing = catMap.get(key);
      if (!existing || run.round > existing.lastRound) {
        catMap.set(key, { name: run.name || "", lastRound: run.round });
      }
      qualifiers.set(run.category, catMap);
    }
  }

  const results: DidNotRace[] = [];

  for (const [category, catMap] of qualifiers) {
    const catElimNumbers = elimCarNumbers.get(category) || new Set();
    if (catElimNumbers.size === 0) continue;

    for (const [key, info] of catMap) {
      const carNum = key.split("|||")[0];
      if (!catElimNumbers.has(carNum)) {
        results.push({
          name: info.name,
          car_number: carNum,
          category,
          lastRound: info.lastRound,
        });
      }
    }
  }

  return results.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

// ─── Tech-card-based "didn't show" detection ──────────────────────────────
//
// Combines two sources to surface every entered car that's missing from
// elimination racing for the current event:
//
//   1. Cars that posted Q/T runs but never ran an E round (the same set
//      that `getDidNotRace` returns).
//   2. Cars that have a tech card on file but no runs at this event at all
//      — uploaded but never even staged for qualifying.
//
// Tech-card matching is by car number + (class_name OR category code), so
// scrape categories like "SUPER STREET" line up with tech-card entries that
// store "Super Street" / "SST".

export interface MissingEntry {
  name: string;
  car_number: string;
  category: string;          // best-guess display category (run category if seen, else tech-card class)
  lastRound: string | null;  // "Q3" / "T1" if any qualifying ran, null if entered but never ran
  source: "qualifying" | "tech_card" | "both";
}

const CATEGORY_CODE_TABLE: Record<string, string> = (() => {
  // Inline copy keyed by uppercase-normalized name → code, populated from
  // schedule-classes.ts lazily without importing it (db.ts is server-only).
  // Kept up-to-date with the few pro/sportsman classes that matter for
  // tech-card matching; unknown classes fall through to a name match.
  const m: Record<string, string> = {};
  const pairs: Array<[string, string]> = [
    ["TOP FUEL", "TF"], ["FUNNY CAR", "FC"], ["PRO STOCK", "PS"],
    ["PRO STOCK MOTORCYCLE", "PSM"], ["PRO MOD", "PM"],
    ["TOP ALCOHOL DRAGSTER", "TAD"], ["TOP ALCOHOL FUNNY CAR", "TAFC"],
    ["TOP DRAGSTER", "TD"], ["TOP SPORTSMAN", "TS"],
    ["FACTORY STOCK SHOWDOWN", "FSS"], ["MOUNTAIN MOTOR PRO STOCK", "MMPS"],
    ["COMPETITION ELIMINATOR", "COMP"], ["COMP ELIMINATOR", "COMP"],
    ["SUPER COMP", "SC"], ["SUPER GAS", "SG"], ["SUPER STREET", "SST"],
    ["SUPER STOCK", "SS"], ["STOCK ELIMINATOR", "STK"], ["STOCK", "STK"],
    ["SUPER PRO", "SPRO"], ["PRO ET", "PRO"], ["SPORTSMAN", "SPTM"],
    ["SPORTSMAN MOTORCYCLE", "SMC"], ["JR DRAGSTER", "JR"], ["JR STREET", "JS"],
    ["TOP FUEL MOTORCYCLE", "TFM"], ["HEMI CHALLENGE", "HC"],
  ];
  for (const [name, code] of pairs) m[name] = code;
  return m;
})();

function normalizeCat(s: string | null | undefined): string {
  return (s || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function categoryCodeFromName(name: string | null | undefined): string {
  return CATEGORY_CODE_TABLE[normalizeCat(name)] || "";
}

function categoriesMatch(tcCategory: string, tcClassName: string, runCategory: string): boolean {
  const runNorm = normalizeCat(runCategory);
  if (!runNorm) return false;
  if (tcClassName && normalizeCat(tcClassName) === runNorm) return true;
  const tcNorm = normalizeCat(tcCategory);
  if (!tcNorm) return false;
  if (tcNorm === runNorm) return true;
  const runCode = categoryCodeFromName(runCategory);
  if (runCode && tcNorm === runCode) return true;
  return false;
}

export async function getMissingFromEliminations(
  eventCode: string,
  season: string,
  eventName?: string,
): Promise<MissingEntry[]> {
  const allRuns = await getEventRuns(eventCode, season);

  // Per-category index of every car number that appears in any run of that
  // category, separated by elim vs qualifying.
  const elimCars = new Map<string, Set<string>>();
  const qualCars = new Map<string, Map<string, { name: string; lastRound: string }>>();
  const everyCarsByCategory = new Map<string, Set<string>>();

  for (const run of allRuns) {
    if (!run.car_number || !run.category || !run.round) continue;
    const carNum = run.car_number.trim();
    const cat = run.category;
    if (!everyCarsByCategory.has(cat)) everyCarsByCategory.set(cat, new Set());
    everyCarsByCategory.get(cat)!.add(carNum);

    if (run.round.startsWith("E")) {
      if (!elimCars.has(cat)) elimCars.set(cat, new Set());
      elimCars.get(cat)!.add(carNum);
    } else if (run.round.startsWith("Q") || run.round.startsWith("T")) {
      const catMap = qualCars.get(cat) || new Map();
      const key = carNum;
      const existing = catMap.get(key);
      if (!existing || run.round > existing.lastRound) {
        catMap.set(key, { name: run.name || "", lastRound: run.round });
      }
      qualCars.set(cat, catMap);
    }
  }

  const results: MissingEntry[] = [];
  const seenKeys = new Set<string>();
  const addEntry = (e: MissingEntry) => {
    const key = `${e.category}|${e.car_number}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    results.push(e);
  };

  // Source 1: cars that ran Q/T but never an E round in their category.
  for (const [category, catMap] of qualCars) {
    const elimSet = elimCars.get(category) || new Set();
    if (elimSet.size === 0) continue; // category never started elims
    for (const [carNum, info] of catMap) {
      if (elimSet.has(carNum)) continue;
      addEntry({
        name: info.name,
        car_number: carNum,
        category,
        lastRound: info.lastRound,
        source: "qualifying",
      });
    }
  }

  // Source 2: tech card entries with no runs at all for this event.
  let techCards: TechCardEntry[] = [];
  try {
    const db = getDb();
    const snap = await db.collection("tech_cards").get();
    techCards = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TechCardEntry));
  } catch (err) {
    console.error("[DB] Failed to load tech cards:", err);
  }
  const tcForEvent = eventName
    ? techCards.filter((tc) => !tc.event_name || tc.event_name === eventName)
    : techCards;

  for (const tc of tcForEvent) {
    if (!tc.car_number || !tc.car_number.trim()) continue;
    const carNum = tc.car_number.trim();
    // Pick the best-matching scraped category for display, if the tech card
    // class lines up with one we already saw at this event.
    let matchedRunCategory: string | null = null;
    for (const [runCat] of everyCarsByCategory) {
      if (categoriesMatch(tc.category, tc.class_name, runCat)) {
        matchedRunCategory = runCat;
        break;
      }
    }
    const displayCategory = matchedRunCategory || tc.class_name || tc.category || "Unknown";
    if (!matchedRunCategory) {
      // Tech-card class never even appeared at this event — definitely a
      // no-show. Mark as no-runs entry.
      addEntry({
        name: `${tc.first_name || ""} ${tc.last_name || ""}`.trim(),
        car_number: carNum,
        category: displayCategory,
        lastRound: null,
        source: "tech_card",
      });
      continue;
    }
    const everySet = everyCarsByCategory.get(matchedRunCategory) || new Set();
    if (everySet.has(carNum)) {
      // Car raced in this category somewhere — already covered by the
      // qualifying loop above (or actually made elims, in which case skip).
      continue;
    }
    addEntry({
      name: `${tc.first_name || ""} ${tc.last_name || ""}`.trim(),
      car_number: carNum,
      category: matchedRunCategory,
      lastRound: null,
      source: "tech_card",
    });
  }

  return results.sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
}

// ─── Doubled-up racers (same driver entered in multiple classes) ──────────
//
// Groups the event's runs by driver name across categories. A racer who
// appears in 2+ categories is "doubled up"; for each of their classes we work
// out whether they're still alive in eliminations or already out (and at
// which round they lost). Race control uses this to predict staging waits: a
// racer still alive in two classes will hold up whichever class is called
// while they're in the other lane.

export interface DoubleClassEntry {
  category: string;
  car_number: string;
  // "in" = still alive in elims; "out" = lost / missed elims; "won" = won the
  // event (done racing, but not by losing); "qualifying" = class hasn't
  // started eliminations yet (treated as alive).
  status: "in" | "out" | "won" | "qualifying";
  lastElimRound: string | null;  // deepest E/F round they ran, if any
  lostRound: string | null;      // round where they lost (when status is "out")
  outReason: "lost" | "missed_elims" | null;
  // They won their deepest round but a later round already has runs without
  // them — either their pair simply hasn't run yet, or a potential no-show.
  laterRoundStarted: boolean;
  runCount: number;
}

export interface DoubledRacer {
  name: string;
  member_number: string | null;
  // "doubled" = alive in 2+ classes (the waiting case), "single" = alive in
  // exactly one, "done" = out (or event winner) everywhere.
  status: "doubled" | "single" | "done";
  aliveCount: number;
  entries: DoubleClassEntry[];
}

function isElimRound(round: string | null | undefined): boolean {
  return !!round && (/^E\d+$/.test(round) || round === "F");
}

function isRunWinner(run: RunRow): boolean {
  const r = (run.result || "").trim().toUpperCase();
  return r === "W" || (!r && run.is_winner === 1);
}

export async function getDoubledUpRacers(
  eventCode: string,
  season: string,
): Promise<DoubledRacer[]> {
  const allRuns = await getEventRuns(eventCode, season);
  tagRunTimestamps(allRuns);

  // Per-category elimination context: which rounds have run, and which car
  // numbers appear in each round (for "later round already started" checks).
  const catElimRounds = new Map<string, Map<string, Set<string>>>();
  for (const run of allRuns) {
    if (!run.category || !isElimRound(run.round)) continue;
    let rounds = catElimRounds.get(run.category);
    if (!rounds) catElimRounds.set(run.category, (rounds = new Map()));
    let cars = rounds.get(run.round!);
    if (!cars) rounds.set(run.round!, (cars = new Set()));
    if (run.car_number) cars.add(run.car_number.trim());
  }

  // Group runs by driver name (normalized), split by category. Names are the
  // only identity that survives across classes — the same driver usually
  // carries a different car number in each class.
  const byRacer = new Map<string, { name: string; byCategory: Map<string, RunRow[]> }>();
  for (const run of allRuns) {
    const rawName = (run.name || "").trim();
    if (!rawName || !run.category) continue;
    if (/^(BYE|TBD|COMPETITION BYE)$/i.test(rawName)) continue;
    const key = rawName.toUpperCase().replace(/\s+/g, " ");
    let racer = byRacer.get(key);
    if (!racer) byRacer.set(key, (racer = { name: rawName, byCategory: new Map() }));
    const list = racer.byCategory.get(run.category);
    if (list) list.push(run);
    else racer.byCategory.set(run.category, [run]);
  }

  const doubled = [...byRacer.values()].filter((r) => r.byCategory.size >= 2);

  let memberMap = new Map<string, string>();
  try {
    memberMap = await bulkLookupMembership(doubled.map((r) => r.name));
  } catch (err) {
    console.error("[DB] Membership lookup failed for doubles:", err);
  }

  const results: DoubledRacer[] = doubled.map((racer) => {
    const entries: DoubleClassEntry[] = [];

    for (const [category, runs] of racer.byCategory) {
      const sorted = [...runs].sort((a, b) =>
        tsSortKey(a.timestamp || "").localeCompare(tsSortKey(b.timestamp || "")),
      );
      const carNumber =
        [...sorted].reverse().find((r) => r.car_number?.trim())?.car_number?.trim() || "";

      const elimRuns = sorted.filter((r) => isElimRound(r.round));
      const categoryRounds = catElimRounds.get(category) || new Map<string, Set<string>>();

      const entry: DoubleClassEntry = {
        category,
        car_number: carNumber,
        status: "in",
        lastElimRound: null,
        lostRound: null,
        outReason: null,
        laterRoundStarted: false,
        runCount: runs.length,
      };

      if (elimRuns.length === 0) {
        if (categoryRounds.size === 0) {
          entry.status = "qualifying";
        } else {
          // Class is into eliminations and they never ran one — DNQ'd or sat out.
          entry.status = "out";
          entry.outReason = "missed_elims";
        }
        entries.push(entry);
        continue;
      }

      // Deepest round they reached; if they somehow have multiple runs in that
      // round (rerun), the latest one decides.
      let deepest = elimRuns[0];
      for (const r of elimRuns) {
        if (roundOrder(r.round!) >= roundOrder(deepest.round!)) deepest = r;
      }
      entry.lastElimRound = deepest.round;

      if (!isRunWinner(deepest)) {
        entry.status = "out";
        entry.outReason = "lost";
        entry.lostRound = deepest.round;
        entries.push(entry);
        continue;
      }

      if (deepest.round === "F") {
        entry.status = "won";
        entries.push(entry);
        continue;
      }

      // Won their last round — still in. Note when a later round has already
      // started without them, so the UI can hint at a pending pair / no-show.
      const deepestOrder = roundOrder(deepest.round!);
      for (const [round, cars] of categoryRounds) {
        if (roundOrder(round) <= deepestOrder) continue;
        if (cars.size > 0 && !(carNumber && cars.has(carNumber))) {
          entry.laterRoundStarted = true;
          break;
        }
      }
      entries.push(entry);
    }

    entries.sort((a, b) => a.category.localeCompare(b.category));
    const aliveCount = entries.filter(
      (e) => e.status === "in" || e.status === "qualifying",
    ).length;

    return {
      name: racer.name,
      member_number: memberMap.get(racer.name) || null,
      status: aliveCount >= 2 ? "doubled" : aliveCount === 1 ? "single" : "done",
      aliveCount,
      entries,
    } as DoubledRacer;
  });

  const statusRank = { doubled: 0, single: 1, done: 2 } as const;
  return results.sort(
    (a, b) => statusRank[a.status] - statusRank[b.status] || a.name.localeCompare(b.name),
  );
}

export async function getFetchLog(): Promise<{ id: string; event_code: string; season: string; event_type: string; fetched_at: string; run_count: number }[]> {
  try {
    const db = getDb();
    const snap = await db.collection("fetch_log").orderBy("fetched_at", "desc").limit(50).get();
    const log: FetchLogEntry[] = [];
    snap.forEach((doc) => log.push(doc.data() as FetchLogEntry));
    return log.map((entry, i) => ({ id: String(i), ...entry }));
  } catch {
    return [];
  }
}

export async function getOpponentsForRuns(runs: RunRow[], eventCode: string, season: string): Promise<{ opponents: Map<string, RunRow[]>; tsGroups: Map<string, string> }> {
  const targetTimestamps = new Set(runs.map((r) => r.timestamp).filter(Boolean) as string[]);
  if (targetTimestamps.size === 0) return { opponents: new Map(), tsGroups: new Map() };

  const allEventRuns = await getEventRuns(eventCode, season);
  const allTimestamps = allEventRuns.map((r) => r.timestamp).filter(Boolean) as string[];
  const tsGroups = buildTimestampGroups(allTimestamps);

  // Find which canonical groups our target runs belong to
  const targetGroups = new Set<string>();
  for (const ts of targetTimestamps) {
    targetGroups.add(tsGroups.get(ts) || ts);
  }

  const opponents = new Map<string, RunRow[]>();
  for (const run of allEventRuns) {
    if (!run.timestamp) continue;
    const canonical = tsGroups.get(run.timestamp) || run.timestamp;
    if (targetGroups.has(canonical)) {
      const arr = opponents.get(canonical) || [];
      arr.push(run);
      opponents.set(canonical, arr);
    }
  }
  return { opponents, tsGroups };
}

export interface ScheduleEntry {
  category: string;
  round: string;
  firstTimestamp: string;
  lastTimestamp: string;
  totalRuns: number;
  pairCount: number;
  durationMinutes: number;
}

const parseTsToDate = parseTsToDateShared;

function tsSortKey(ts: string): string {
  const d = parseTsToDate(ts);
  return d ? d.toISOString() : ts;
}

/**
 * Infer AM/PM for raw 12-hour timestamps.
 * Sorts by the time component using race-day ordering (6-11 AM, 12 PM, 1-5 PM).
 *
 * Default: starts in AM mode. Once hour 12 appears, switches to PM.
 * If pmStart is true, starts in PM mode (for days that only race afternoon).
 */
function stripAmPm(ts: string): string {
  return ts.replace(/ (AM|PM)$/i, "");
}

// Round progression weight for same-day sorting
// Within one day, rounds always progress: T1 < T2 < Q1 < R1 < R2 < ... < F
function roundSortWeight(round: string | null): number {
  if (!round) return 0;
  const r = round.toUpperCase();
  if (r === "F" || r === "FINAL") return 100;
  const prefix = r.charAt(0);
  const num = parseInt(r.slice(1), 10) || 0;
  if (prefix === "T") return num;           // T1=1, T2=2
  if (prefix === "Q") return 10 + num;      // Q1=11, Q2=12
  if (prefix === "R" || prefix === "E" || prefix === "C") return 20 + num; // R1=21, R2=22, C1=21
  return 0;
}

// Sort key for same-day chronological ordering
// Primary: time of day (8 AM → noon → 7 PM)
// Secondary: round progression (R1 before R2 at same hour)
// This breaks ties when AM and PM runs share the same raw hour
function raceDaySortKey(ts: string, round: string | null, isPm: boolean = false): number {
  const timePart = ts.split(" ")[1];
  if (!timePart) return 0;
  const [hh, mm, ss] = timePart.split(":").map(Number);

  let h24: number;
  if (hh >= 8 && hh <= 11) {
    h24 = hh;          // 8-11 = always morning
  } else if (hh === 12) {
    h24 = 12;           // 12 = always noon
  } else if (hh >= 1 && hh <= 5) {
    h24 = hh + 12;      // 1-5 = always afternoon
  } else {
    // Hours 6-7: determined by same-day context passed via isPm
    h24 = isPm ? hh + 12 : hh;
  }

  // Time as primary sort, round weight as tiebreaker within same minute
  return h24 * 3600 + (mm || 0) * 60 + (ss || 0) + roundSortWeight(round) * 0.001;
}

function tsHour(ts: string): number {
  const timePart = ts.split(" ")[1];
  return timePart ? parseInt(timePart.split(":")[0], 10) : 0;
}

function tagRunTimestamps(runs: RunRow[], pmStart: boolean = false): void {
  for (const run of runs) {
    // Never strip the AM/PM off an exact (API-sourced) timestamp — it's already
    // correct. Only scraper rows, which arrive without a marker, get re-inferred.
    if (run.timestamp && !run._ts_exact) run.timestamp = stripAmPm(run.timestamp);
  }

  // Group runs by day — each day is processed independently
  const byDay = new Map<string, RunRow[]>();
  for (const run of runs) {
    if (!run.timestamp) continue;
    const day = run.timestamp.split(" ")[0];
    const arr = byDay.get(day) || [];
    arr.push(run);
    byDay.set(day, arr);
  }

  for (const [, dayRuns] of byDay) {
    // The NHRA data comes in chronological order. Sort by scrape sequence
    // (when available) and walk: start AM, flip to PM when we first see
    // an hour 1-5 run after morning hours. Hours 1-5 are always PM.
    //
    // For data without scrape sequence, sort by raw 12-hour time using
    // raceDaySortKey and apply the same walk.

    const hasScrapeSeq = dayRuns.some((r) => r._scrape_seq != null);

    if (hasScrapeSeq) {
      dayRuns.sort((a, b) => (a._scrape_seq ?? 0) - (b._scrape_seq ?? 0));
    } else {
      dayRuns.sort((a, b) =>
        raceDaySortKey(a.timestamp!, a.round, false) -
        raceDaySortKey(b.timestamp!, b.round, false)
      );
    }

    // Walk in order: AM until we see hour 12 or 1-5, then PM.
    let passedNoon = pmStart;
    let seenMorning = false;

    for (const run of dayRuns) {
      const h = tsHour(run.timestamp!);

      // Exact rows already have the right marker — don't re-tag them. Still let
      // their known AM/PM advance the walk so any inferred rows sharing the day
      // flip correctly (a PM exact run means we're past noon).
      if (run._ts_exact) {
        if (/PM\s*$/i.test(run.timestamp!)) passedNoon = true;
        else if (h >= 6 && h <= 11) seenMorning = true;
        continue;
      }

      if (h >= 6 && h <= 11) seenMorning = true;

      // Noon crossing: hour 12 or 1-5 after we've seen morning hours
      if (!passedNoon && seenMorning && (h === 12 || (h >= 1 && h <= 5))) {
        passedNoon = true;
      }

      // Hours 12 and 1-5 are always PM regardless of context
      if (h === 12 || (h >= 1 && h <= 5)) {
        run.timestamp += " PM";
      } else {
        run.timestamp += passedNoon ? " PM" : " AM";
      }
    }
  }
}

const SESSION_GAP_MAX_MIN = 10;

export async function getIgnoredKeys(eventCode: string, season: string): Promise<Set<string>> {
  try {
    const db = getDb();
    const doc = await db.collection("ignored_runs").doc(`${eventCode}_${season}`).get();
    if (doc.exists) {
      const keys: string[] = doc.data()?.keys || [];
      return new Set(keys.map(normalizeDedupKey));
    }
  } catch (err) {
    console.error("[DB] Failed to load ignored keys:", err);
  }
  return new Set();
}

export async function getScheduleData(eventCode: string, season: string, pmStart: boolean = false): Promise<ScheduleEntry[]> {
  const [allRuns, ignoredKeys] = await Promise.all([
    getEventRuns(eventCode, season),
    getIgnoredKeys(eventCode, season),
  ]);

  tagRunTimestamps(allRuns, pmStart);

  const eventRuns = ignoredKeys.size > 0
    ? allRuns.filter((r) => !r._dedup_key || !ignoredKeys.has(r._dedup_key))
    : allRuns;

  // Build timestamp groups per category/round so nearby timestamps are merged
  const runsByKey = new Map<string, RunRow[]>();
  eventRuns.forEach((run) => {
    if (!run.category || !run.round || !run.timestamp) return;
    const key = `${run.category}|||${run.round}`;
    const arr = runsByKey.get(key) || [];
    arr.push(run);
    runsByKey.set(key, arr);
  });

  const grouped = new Map<string, { timestamps: Map<string, Set<string>>; }>();

  for (const [key, keyRuns] of runsByKey) {
    const tsGroups = buildTimestampGroups(keyRuns.map((r) => r.timestamp!));
    const entry: { timestamps: Map<string, Set<string>> } = { timestamps: new Map() };

    for (const run of keyRuns) {
      const canonical = tsGroups.get(run.timestamp!) || run.timestamp!;
      const uniqueRunKey =
        run._dedup_key ||
        `${run.timestamp}|${run.car_number || ""}|${run.lane || ""}|${run.name || ""}|${run.category}|${run.round}`;
      const tsRuns = entry.timestamps.get(canonical) || new Set<string>();
      tsRuns.add(uniqueRunKey);
      entry.timestamps.set(canonical, tsRuns);
    }
    grouped.set(key, entry);
  }

  const entries: ScheduleEntry[] = [];

  for (const [key, data] of grouped) {
    const [category, round] = key.split("|||");
    const sortedTs = Array.from(data.timestamps.keys()).sort((a, b) => tsSortKey(a).localeCompare(tsSortKey(b)));

    if (sortedTs.length < 2) {
      const runCount = Array.from(data.timestamps.values()).reduce((a, b) => a + b.size, 0);
      entries.push({
        category, round,
        firstTimestamp: sortedTs[0],
        lastTimestamp: sortedTs[0],
        totalRuns: runCount,
        pairCount: sortedTs.length,
        durationMinutes: 0,
      });
      continue;
    }

    const splitIndices: number[] = [];
    for (let i = 1; i < sortedTs.length; i++) {
      const prev = parseTsToDate(sortedTs[i - 1]);
      const curr = parseTsToDate(sortedTs[i]);
      if (prev && curr) {
        const gapMin = (curr.getTime() - prev.getTime()) / 60000;
        if (gapMin >= SESSION_GAP_MAX_MIN) splitIndices.push(i);
      }
    }

    const segments: string[][] = [];
    let start = 0;
    for (const idx of splitIndices) {
      segments.push(sortedTs.slice(start, idx));
      start = idx;
    }
    segments.push(sortedTs.slice(start));

    for (const seg of segments) {
      if (seg.length === 0) continue;
      const first = seg[0];
      const last = seg[seg.length - 1];
      let runCount = 0;
      for (const ts of seg) runCount += data.timestamps.get(ts)?.size || 0;

      let durationMinutes = 0;
      const dFirst = parseTsToDate(first);
      const dLast = parseTsToDate(last);
      if (dFirst && dLast) {
        durationMinutes = Math.round((dLast.getTime() - dFirst.getTime()) / 60000);
      }

      entries.push({
        category, round,
        firstTimestamp: first,
        lastTimestamp: last,
        totalRuns: runCount,
        pairCount: seg.length,
        durationMinutes,
      });
    }
  }

  entries.sort((a, b) => tsSortKey(a.firstTimestamp).localeCompare(tsSortKey(b.firstTimestamp)));
  return entries;
}

export interface BestLosingPackageEntry {
  name: string;
  car_number: string;
  category: string;
  round: string;
  rt: number;
  ft1320: number;
  dial_in: number;
  diff: number;      // ET - dial_in (how close to dial)
  package: number;    // RT + diff
  timestamp: string;
}

export async function getBestLosingPackage(
  eventCode: string,
  season: string,
  rounds: string[],
  categories: string[]
): Promise<Record<string, BestLosingPackageEntry[]>> {
  const allRuns = await getEventRuns(eventCode, season);
  tagRunTimestamps(allRuns);

  const roundSet = new Set(rounds);
  const categorySet = new Set(categories);

  // Filter to elimination losers with valid data
  const losers = allRuns.filter((r) => {
    if (!r.round || !roundSet.has(r.round)) return false;
    if (!r.category || !categorySet.has(r.category)) return false;
    if (r.is_winner === 1) return false;
    if (r.rt === null || r.rt === undefined || r.rt < 0) return false;
    if (!r.ft1320 || r.ft1320 <= 0) return false;
    // Use dial_in if available, otherwise try parsing class_index as a number
    const dialValue = (r.dial_in != null && r.dial_in > 0) ? r.dial_in : (r.class_index ? parseFloat(r.class_index) : NaN);
    if (isNaN(dialValue) || dialValue <= 0) return false;
    // Exclude breakouts (ran faster than dial-in)
    if (r.ft1320 < dialValue) return false;
    (r as RunRow & { _dialValue?: number })._dialValue = dialValue;
    return true;
  });

  const result: Record<string, BestLosingPackageEntry[]> = {};

  for (const cat of categories) {
    const catLosers = losers
      .filter((r) => r.category === cat)
      .map((r) => {
        const dialValue = (r as RunRow & { _dialValue?: number })._dialValue ?? r.dial_in!;
        const diff = r.ft1320! - dialValue;
        return {
          name: r.name || "Unknown",
          car_number: r.car_number || "",
          category: cat,
          round: r.round!,
          rt: r.rt!,
          ft1320: r.ft1320!,
          dial_in: dialValue,
          diff: Math.round(diff * 10000) / 10000,
          package: Math.round((r.rt! + diff) * 10000) / 10000,
          timestamp: r.timestamp || "",
        };
      })
      .sort((a, b) => a.package - b.package)
      .slice(0, 5);

    if (catLosers.length > 0) {
      result[cat] = catLosers;
    }
  }

  return result;
}

export interface EventWinnerEntry {
  name: string;
  car_number: string;
  category: string;
  round: string;
  rt: number;
  ft1320: number;
  dial_in: number;
  package: number;
  timestamp: string;
}

export async function getEventWinners(
  eventCode: string,
  season: string,
  categories: string[]
): Promise<EventWinnerEntry[]> {
  const allRuns = await getEventRuns(eventCode, season);
  tagRunTimestamps(allRuns);

  const categorySet = new Set(categories);
  // Find the last elimination round winner per category (the event winner)
  const winnerMap = new Map<string, RunRow>();

  for (const r of allRuns) {
    if (!r.category || !categorySet.has(r.category)) continue;
    if (!r.round || !(r.round.startsWith("E") || r.round === "F")) continue;
    if (r.is_winner !== 1) continue;

    const existing = winnerMap.get(r.category);
    if (!existing || roundOrder(r.round) > roundOrder(existing.round!)) {
      winnerMap.set(r.category, r);
    }
  }

  return Array.from(winnerMap.values()).map((r) => {
    const dialValue = (r.dial_in && r.dial_in > 0) ? r.dial_in : (r.class_index ? parseFloat(r.class_index) : 0);
    const diff = (r.ft1320 && dialValue > 0) ? r.ft1320 - dialValue : 0;
    const pkg = (r.rt != null && r.rt >= 0 && diff >= 0) ? r.rt + diff : 0;
    return {
      name: r.name || "Unknown",
      car_number: r.car_number || "",
      category: r.category!,
      round: r.round!,
      rt: r.rt || 0,
      ft1320: r.ft1320 || 0,
      dial_in: dialValue,
      package: Math.round(pkg * 10000) / 10000,
      timestamp: r.timestamp || "",
    };
  }).sort((a, b) => a.category.localeCompare(b.category));
}

function roundOrder(round: string): number {
  if (round === "F") return 100;
  const m = round.match(/^E(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

export interface PerfectRTEntry {
  name: string;
  car_number: string;
  category: string;
  round: string;
  rt: number;
  ft1320: number | null;
  is_winner: number;
  timestamp: string;
}

export async function getPerfectReactionTimes(
  eventCode: string,
  season: string,
  roundTypes?: string[]
): Promise<Record<string, PerfectRTEntry[]>> {
  const allRuns = await getEventRuns(eventCode, season);
  tagRunTimestamps(allRuns);

  const types = new Set(roundTypes && roundTypes.length > 0 ? roundTypes : ["eliminations"]);

  const perfects = allRuns.filter((r) => {
    if (!r.round || !r.category || r.rt == null) return false;

    const rd = r.round.toUpperCase();
    const isElim = rd.startsWith("E") || rd.startsWith("R") || rd.startsWith("C") || rd === "F" || rd === "FINAL";
    const isQual = rd.startsWith("Q");
    const isTT = rd.startsWith("T");

    if (!((types.has("eliminations") && isElim) || (types.has("qualifying") && isQual) || (types.has("time_trials") && isTT))) return false;

    // Perfect RT is exactly 0.000 — must be non-negative, within tolerance,
    // and the run must have a valid finish time (excludes resets with rt=0 but no ET)
    if (r.rt < 0 || r.rt >= 0.0005) return false;
    if (r.ft1320 == null || r.ft1320 <= 0) return false;
    return true;
  });

  const result: Record<string, PerfectRTEntry[]> = {};

  for (const r of perfects) {
    const cat = r.category!;
    const entry: PerfectRTEntry = {
      name: r.name || "Unknown",
      car_number: r.car_number || "",
      category: cat,
      round: r.round!,
      rt: r.rt!,
      ft1320: r.ft1320,
      is_winner: r.is_winner,
      timestamp: r.timestamp || "",
    };
    (result[cat] ??= []).push(entry);
  }

  // Sort each category by round
  for (const cat of Object.keys(result)) {
    result[cat].sort((a, b) => a.round.localeCompare(b.round) || a.timestamp.localeCompare(b.timestamp));
  }

  return result;
}

export interface DeadOnEntry {
  name: string;
  car_number: string;
  category: string;
  round: string;
  rt: number | null;
  ft1320: number;
  dial_in: number;
  is_winner: number;
  timestamp: string;
}

export async function getDeadOnRuns(
  eventCode: string,
  season: string
): Promise<Record<string, DeadOnEntry[]>> {
  const allRuns = await getEventRuns(eventCode, season);
  tagRunTimestamps(allRuns);

  const deadOns = allRuns.filter((r) => {
    const rd = (r.round || "").toUpperCase();
    if (!rd.startsWith("E") && !rd.startsWith("R") && !rd.startsWith("C") && rd !== "F" && rd !== "FINAL") return false;
    if (!r.category) return false;
    if (!r.ft1320 || r.ft1320 <= 0) return false;
    if (!r.dial_in || r.dial_in <= 0) return false;
    // Dead on = ET matches dial-in to the thousandth
    return Math.round(r.ft1320 * 1000) === Math.round(r.dial_in * 1000);
  });

  const result: Record<string, DeadOnEntry[]> = {};

  for (const r of deadOns) {
    const cat = r.category!;
    const entry: DeadOnEntry = {
      name: r.name || "Unknown",
      car_number: r.car_number || "",
      category: cat,
      round: r.round!,
      rt: r.rt,
      ft1320: r.ft1320!,
      dial_in: r.dial_in!,
      is_winner: r.is_winner,
      timestamp: r.timestamp || "",
    };
    (result[cat] ??= []).push(entry);
  }

  for (const cat of Object.keys(result)) {
    result[cat].sort((a, b) => a.round.localeCompare(b.round) || a.timestamp.localeCompare(b.timestamp));
  }

  return result;
}

export async function getLatestPair(eventCode: string, season: string): Promise<RunRow[]> {
  const runs = await getEventRuns(eventCode, season);
  tagRunTimestamps(runs);

  const withTimestamp = runs.filter((r) => r.timestamp);
  const withData = withTimestamp.filter((r) => r.rt != null || r.ft1320 != null || r.ft660 != null);
  if (withData.length === 0) return [];

  // Find the latest run that has timing data
  const sorted = [...withData].sort((a, b) => tsSortKey(b.timestamp!).localeCompare(tsSortKey(a.timestamp!)));
  const latestRun = sorted[0];

  // Include ALL runs with a timestamp in the same category+round (even those without timing data,
  // e.g. in 4-wide races where some lanes may not have RT/ET yet)
  const sameRace = withTimestamp.filter(
    (r) => r.category === latestRun.category && r.round === latestRun.round
  );
  // Use wider tolerance (3s) to capture all lanes in 4-wide races where
  // lanes 1&2 and 3&4 may have timestamps several seconds apart
  const FOUR_WIDE_TOLERANCE = 3;
  const raceTs = sameRace.map((r) => r.timestamp!);
  const tsGroups = buildTimestampGroups(raceTs, FOUR_WIDE_TOLERANCE);
  const latestCanonical = tsGroups.get(latestRun.timestamp!) || latestRun.timestamp!;
  return sameRace
    .filter((r) => (tsGroups.get(r.timestamp!) || r.timestamp!) === latestCanonical)
    .sort((a, b) => tsSortKey(b.timestamp!).localeCompare(tsSortKey(a.timestamp!)));
}

// Returns the most recent pair of cars that have been staged to run but haven't
// recorded timing data yet. These are cars with a timestamp but no rt/ft1320/
// ft660 values — the NHRA system posts pairings before they actually run.
export async function getNextPair(eventCode: string, season: string): Promise<RunRow[]> {
  const runs = await getEventRuns(eventCode, season);
  tagRunTimestamps(runs);

  const withTimestamp = runs.filter((r) => r.timestamp);
  const withoutData = withTimestamp.filter(
    (r) => r.rt == null && r.ft1320 == null && r.ft660 == null && r.ft60 == null
  );
  if (withoutData.length === 0) return [];

  // Most recent staged run
  const sorted = [...withoutData].sort((a, b) =>
    tsSortKey(b.timestamp!).localeCompare(tsSortKey(a.timestamp!))
  );
  const latestStaged = sorted[0];

  // Group by timestamp + category + round to get the full pair (or quad)
  const sameRace = withTimestamp.filter(
    (r) => r.category === latestStaged.category && r.round === latestStaged.round
  );
  const FOUR_WIDE_TOLERANCE = 3;
  const raceTs = sameRace.map((r) => r.timestamp!);
  const tsGroups = buildTimestampGroups(raceTs, FOUR_WIDE_TOLERANCE);
  const latestCanonical = tsGroups.get(latestStaged.timestamp!) || latestStaged.timestamp!;
  return sameRace
    .filter((r) => (tsGroups.get(r.timestamp!) || r.timestamp!) === latestCanonical)
    .sort((a, b) => tsSortKey(b.timestamp!).localeCompare(tsSortKey(a.timestamp!)));
}

// --------------- Tech Card Data ---------------

export interface TechCardEntry {
  id?: string;
  car_number: string;
  first_name: string;
  last_name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  occupation: string;
  license_number: string;
  license_expiry: string;
  home_division: string;
  owner: string;
  crew_chief: string;
  category: string;       // abbreviation: SS, SG, TD, etc.
  class_name: string;
  engine_make: string;
  engine_year: string;
  body_type: string;
  body_year: string;
  cu_cc: string;
  hp: string;
  factored_hp: string;
  member_number: string;
  member_expiry: string;
  payee: string;
  bio_lines: string[];    // line1 through line6
  submission_date: string;
  uploaded_at: string;
  event_name?: string;
  // Contact + billing details (captured from the Tech Card Viewer grid;
  // optional because spreadsheet uploads may not include them).
  phone?: string;
  email?: string;
  payee_street?: string;
  payee_city?: string;
  payee_state?: string;
  payee_zip?: string;
  // Team the racer entered under, from the divisional ET tech-card export's
  // `trackteam` column (an NHRA track code like "LV"). Their track team's
  // roster is still what decides who scores; this is an identity hint, used to
  // break a tie when a name or car number would otherwise match two teams.
  track_team?: string;
  // "Team 1" / "Team 2" / "Alternate" from the same export, for tracks fielding
  // more than one team.
  team_slot?: string;
}

export async function saveTechCards(entries: TechCardEntry[]): Promise<{ saved: number; skipped: number }> {
  const db = getDb();
  const col = db.collection("tech_cards");
  let saved = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.car_number && !entry.first_name && !entry.last_name) {
      skipped++;
      continue;
    }
    // Key by member_number + category. A racer's member number is stable while
    // their car number can change between events, so member number is the
    // reliable identity — keying on the car number would create a duplicate
    // record whenever someone re-numbers their car. Fall back to car_number
    // only when a member number is missing.
    const identity = (entry.member_number || "").trim() || (entry.car_number || "").trim();
    const key = `${identity}_${entry.category}`.replace(/[\/\\]/g, "_");
    await col.doc(key).set(entry, { merge: true });
    saved++;
  }

  return { saved, skipped };
}

export async function getTechCardByCarNumber(carNumber: string): Promise<TechCardEntry[]> {
  const db = getDb();
  const snap = await db.collection("tech_cards").where("car_number", "==", carNumber).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TechCardEntry));
}

export async function getAllTechCards(): Promise<TechCardEntry[]> {
  const db = getDb();
  const snap = await db.collection("tech_cards").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TechCardEntry));
}

export async function getTechCardByName(firstName: string, lastName: string): Promise<TechCardEntry[]> {
  const db = getDb();
  const snap = await db.collection("tech_cards")
    .where("first_name", "==", firstName)
    .where("last_name", "==", lastName)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TechCardEntry));
}

export async function searchTechCards(query: string): Promise<TechCardEntry[]> {
  const db = getDb();
  const snap = await db.collection("tech_cards").get();
  const q = query.toLowerCase();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as TechCardEntry))
    .filter((t) => {
      const fullName = `${t.first_name} ${t.last_name}`.toLowerCase();
      return fullName.includes(q)
        || (!!t.car_number && t.car_number.toLowerCase().includes(q))
        || (!!t.member_number && t.member_number.toLowerCase().includes(q));
    });
}

// Bulk lookup membership numbers from tech cards for a list of racer names
export async function bulkLookupMembership(names: string[]): Promise<Map<string, string>> {
  const db = getDb();
  const snap = await db.collection("tech_cards").get();
  const cards = snap.docs.map((d) => d.data() as TechCardEntry);
  const result = new Map<string, string>();
  for (const name of names) {
    const lower = name.toLowerCase();
    const match = cards.find((c) => `${c.first_name} ${c.last_name}`.toLowerCase() === lower);
    if (match && match.member_number) {
      result.set(name, match.member_number);
    }
  }
  return result;
}

// --------------- Qualifying ---------------

export interface QualifyingMode {
  id: string;
  label: string;
  description: string;
}

export const QUALIFYING_MODES: QualifyingMode[] = [
  { id: "quickest_et", label: "Quickest to Slowest", description: "Fastest ET wins. Tiebreaker: MPH or who ran first." },
  { id: "closest_index_no_breakout", label: "Closest to Index (No Breakout)", description: "Closest ET to dial-in/index without going quicker. Breakouts excluded." },
  { id: "closest_index_breakout_ok", label: "Closest to Index (Breakout OK)", description: "Closest ET to dial-in/index; going under is allowed, no breakout penalty." },
  { id: "best_rt", label: "Best Reaction Time", description: "Best (lowest) reaction time wins." },
  { id: "comp_eliminator", label: "Competition Eliminator", description: "Furthest under class index = #1 qualifier. Tiebreaker: first to post time. No breakout." },
  { id: "stock_super_stock", label: "Stock / Super Stock", description: "Furthest under class index = #1 qualifier. Tiebreaker: first to post time." },
];

export interface QualifyingConfig {
  /** Map of category -> qualifying mode id */
  classMode: Record<string, string>;
  /** Tiebreaker for quickest_et: "mph" or "first_run" */
  tiebreaker: "mph" | "first_run";
}

export async function getQualifyingConfig(eventCode: string, season: string): Promise<QualifyingConfig> {
  try {
    const db = getDb();
    const doc = await db.collection("qualifying_config").doc(`${eventCode}_${season}`).get();
    if (doc.exists) {
      const data = doc.data()!;
      return {
        classMode: data.classMode || {},
        tiebreaker: data.tiebreaker || "mph",
      };
    }
  } catch (err) {
    console.error("[DB] Failed to load qualifying config:", err);
  }
  return { classMode: {}, tiebreaker: "mph" };
}

export async function saveQualifyingConfig(eventCode: string, season: string, config: QualifyingConfig): Promise<void> {
  const db = getDb();
  await db.collection("qualifying_config").doc(`${eventCode}_${season}`).set(config, { merge: true });
}

export interface QualifyingEntry {
  position: number;
  name: string;
  car_number: string;
  category: string;
  et: number;
  mph: number | null;
  rt: number | null;
  dial_in: number | null;
  diff: number | null;
  round: string;
  timestamp: string;
  membership?: string;
}

export async function getQualifyingResults(
  eventCode: string,
  season: string,
  category: string,
  rounds: string[],
  mode: string,
  tiebreaker: "mph" | "first_run"
): Promise<QualifyingEntry[]> {
  const allRuns = await getEventRuns(eventCode, season);
  tagRunTimestamps(allRuns);

  const roundSet = new Set(rounds.map((r) => r.toUpperCase()));

  // Sort selected rounds: latest first (Q4 > Q3 > Q2 > Q1)
  const sortedRounds = [...roundSet].sort((a, b) => b.localeCompare(a));

  // Filter runs for this category and selected rounds
  const eligible = allRuns.filter((r) => {
    if (!r.category || r.category !== category) return false;
    if (!r.round || !roundSet.has(r.round.toUpperCase())) return false;
    if (r.ft1320 == null || r.ft1320 <= 0) return false;
    if (r.is_dq === 1) return false;
    return true;
  });

  // For index-based modes, get each racer's index from the LATEST qualifying
  // round's dial_in. The national class index is already in the system data.
  // Q4 > Q3 > Q2 > Q1 — first match wins.
  const isIndexMode = mode === "comp_eliminator" || mode === "stock_super_stock" || mode === "closest_index_no_breakout" || mode === "closest_index_breakout_ok";
  const racerIndex = new Map<string, number>();

  if (isIndexMode) {
    const catRuns = allRuns.filter((r) => r.category === category);
    for (const round of sortedRounds) {
      for (const r of catRuns) {
        const key = (r.car_number || "").trim();
        if (!key || racerIndex.has(key)) continue;
        if (!r.round || r.round.toUpperCase() !== round) continue;
        const idx = getDialIn(r);
        if (idx != null) racerIndex.set(key, idx);
      }
    }
  }

  // Group eligible runs by racer (car_number)
  const runsByRacer = new Map<string, RunRow[]>();
  for (const run of eligible) {
    const key = (run.car_number || "").trim();
    if (!key) continue;
    const arr = runsByRacer.get(key) || [];
    arr.push(run);
    runsByRacer.set(key, arr);
  }

  // For each racer, pick their best run using the pre-computed index
  const bestByRacer = new Map<string, RunRow>();
  for (const [carNum, runs] of runsByRacer) {
    const idx = racerIndex.get(carNum) ?? null;
    let best = runs[0];
    for (let i = 1; i < runs.length; i++) {
      if (isBetterQualRunWithIndex(runs[i], best, idx, mode, tiebreaker)) {
        best = runs[i];
      }
    }
    bestByRacer.set(carNum, best);
  }

  // Sort all best runs by the qualifying mode, using pre-computed indexes
  const sorted = Array.from(bestByRacer.entries()).sort(([aKey], [bKey]) => {
    const aRun = bestByRacer.get(aKey)!;
    const bRun = bestByRacer.get(bKey)!;
    const aIdx = racerIndex.get(aKey) ?? null;
    const bIdx = racerIndex.get(bKey) ?? null;
    return compareQualRunsWithIndex(aRun, bRun, aIdx, bIdx, mode, tiebreaker);
  });

  // Look up membership numbers
  const names = sorted.map(([, r]) => r.name || "").filter(Boolean);
  const memberMap = await bulkLookupMembership([...new Set(names)]);

  return sorted.map(([carNum, r], i) => {
    const idx = racerIndex.get(carNum) ?? null;
    const dialValue = isIndexMode
      ? idx
      : ((r.dial_in != null && r.dial_in > 0) ? r.dial_in : (idx ?? null));
    const diff = (r.ft1320 != null && dialValue != null) ? r.ft1320 - dialValue : null;
    return {
      position: i + 1,
      name: r.name || "Unknown",
      car_number: r.car_number || "",
      category: r.category || "",
      et: r.ft1320!,
      mph: r.mph_1320,
      rt: r.rt,
      dial_in: dialValue,
      diff,
      round: r.round || "",
      timestamp: r.timestamp || "",
      membership: memberMap.get(r.name || "") || "",
    };
  });
}

// --------------- NHRA Class Index Table ---------------

// --------------- Class Index Helpers ---------------

export async function getClassIndexTable(eventCode: string, season: string): Promise<Record<string, number>> {
  try {
    const db = getDb();
    const doc = await db.collection("class_indexes").doc(`${eventCode}_${season}`).get();
    if (doc.exists) {
      return doc.data()?.indexes || {};
    }
  } catch (err) {
    console.error("[DB] Failed to load class indexes:", err);
  }
  return {};
}

export async function saveClassIndexTable(eventCode: string, season: string, indexes: Record<string, number>): Promise<void> {
  const db = getDb();
  await db.collection("class_indexes").doc(`${eventCode}_${season}`).set({ indexes }, { merge: true });
}

/** Get a racer's dial_in value (the index/dial from the timing system). */
function getDialIn(r: RunRow): number | null {
  if (r.dial_in != null && r.dial_in > 0) return r.dial_in;
  return null;
}

function isBetterQualRunWithIndex(candidate: RunRow, existing: RunRow, index: number | null, mode: string, tiebreaker: "mph" | "first_run"): boolean {
  return compareQualRunsWithIndex(candidate, existing, index, index, mode, tiebreaker) < 0;
}

function compareQualRunsWithIndex(a: RunRow, b: RunRow, idxA: number | null, idxB: number | null, mode: string, tiebreaker: "mph" | "first_run"): number {
  const dialA = idxA != null ? idxA : NaN;
  const dialB = idxB != null ? idxB : NaN;

  switch (mode) {
    case "quickest_et": {
      const etDiff = (a.ft1320 || 999) - (b.ft1320 || 999);
      if (Math.abs(etDiff) > 0.0001) return etDiff;
      if (tiebreaker === "mph") {
        return (b.mph_1320 || 0) - (a.mph_1320 || 0);
      }
      return (a.timestamp || "").localeCompare(b.timestamp || "");
    }

    case "closest_index_no_breakout": {
      const diffA = (a.ft1320 || 999) - dialA;
      const diffB = (b.ft1320 || 999) - dialB;
      const aBreakout = isNaN(dialA) || diffA < -0.0005;
      const bBreakout = isNaN(dialB) || diffB < -0.0005;
      if (aBreakout && !bBreakout) return 1;
      if (!aBreakout && bBreakout) return -1;
      if (aBreakout && bBreakout) return diffA - diffB;
      return diffA - diffB;
    }

    case "closest_index_breakout_ok": {
      const diffA = Math.abs((a.ft1320 || 999) - dialA);
      const diffB = Math.abs((b.ft1320 || 999) - dialB);
      if (isNaN(dialA) && !isNaN(dialB)) return 1;
      if (!isNaN(dialA) && isNaN(dialB)) return -1;
      return diffA - diffB;
    }

    case "best_rt": {
      const rtA = a.rt != null ? a.rt : 999;
      const rtB = b.rt != null ? b.rt : 999;
      const aFoul = rtA < 0;
      const bFoul = rtB < 0;
      if (aFoul && !bFoul) return 1;
      if (!aFoul && bFoul) return -1;
      if (aFoul && bFoul) return rtB - rtA;
      return rtA - rtB;
    }

    case "comp_eliminator":
    case "stock_super_stock": {
      // Furthest under index = #1. diff = ET - index. Most negative wins.
      if (isNaN(dialA) && !isNaN(dialB)) return 1;
      if (!isNaN(dialA) && isNaN(dialB)) return -1;
      if (isNaN(dialA) && isNaN(dialB)) return 0;
      const diffFromIdxA = (a.ft1320 || 999) - dialA;
      const diffFromIdxB = (b.ft1320 || 999) - dialB;
      if (Math.abs(diffFromIdxA - diffFromIdxB) > 0.0001) return diffFromIdxA - diffFromIdxB;
      // Tiebreaker: first to post the time (earlier timestamp wins)
      return (a.timestamp || "").localeCompare(b.timestamp || "");
    }

    default:
      return 0;
  }
}

// ─── Ladder header storage (per event + category) ─────────────────────────

export interface LadderHeaderRecord {
  eventTitle?: string;
  venue?: string;
  dateRange?: string;
  classTitle?: string;
  seriesBanner?: string;
  runTime?: string;
  runDate?: string;
  roundNumber?: string;
  systemMark?: string;
  lowEt?: { value: string; carNumber: string; driver: string };
  topSpeed?: { value: string; carNumber: string; driver: string };
}

function ladderHeaderKey(eventCode: string, season: string, category: string): string {
  return `${eventCode}_${season}_${category}`;
}

export async function getLadderHeader(
  eventCode: string,
  season: string,
  category: string
): Promise<LadderHeaderRecord | null> {
  if (!eventCode || !season || !category) return null;
  try {
    const db = getDb();
    const doc = await db
      .collection("ladder_headers")
      .doc(ladderHeaderKey(eventCode, season, category))
      .get();
    if (doc.exists) return doc.data() as LadderHeaderRecord;
  } catch (err) {
    console.error("[DB] Failed to load ladder header:", err);
  }
  return null;
}

export async function saveLadderHeader(
  eventCode: string,
  season: string,
  category: string,
  header: LadderHeaderRecord
): Promise<void> {
  if (!eventCode || !season || !category) return;
  const db = getDb();
  await db
    .collection("ladder_headers")
    .doc(ladderHeaderKey(eventCode, season, category))
    .set(header, { merge: true });
}

// ─── Ladder state storage (qualifiers + advancers per event/class) ────────
//
// Persists everything needed to redraw the user's working ladder when they
// come back to /ladder-builder. Saved per (event, season, category).

export interface LadderStateQualifier {
  position: number;
  carNumber?: string | null;
  driver?: string | null;
  classCode?: string | null;
  hometown?: string | null;
  car?: string | null;
  motor?: string | null;
  et?: number | null;
  qMph?: number | null;
  topMph?: number | null;
}

export interface LadderStateRecord {
  fieldSize: number;
  qualifiers: LadderStateQualifier[];
  // Map of "round-quadIndex" → [winnerPosition, runnerUpPosition]
  advancers: Record<string, [number, number]>;
  // Map of "{round}-{seed}" → ET / MPH the seed posted in that round, used to
  // print actual run stats (instead of qualifying ET / MPH) on later-round
  // boxes. Populated by the Auto-fill button.
  seedResults?: Record<string, { et: number | null; mph: number | null }>;
  // Manual mode keeps its own classCode separate from the qualifier rows; we
  // store it so the page can rehydrate it.
  classCode?: string;
}

export async function getLadderState(
  eventCode: string,
  season: string,
  category: string,
): Promise<LadderStateRecord | null> {
  if (!eventCode || !season || !category) return null;
  try {
    const db = getDb();
    const doc = await db
      .collection("ladder_states")
      .doc(ladderHeaderKey(eventCode, season, category))
      .get();
    if (doc.exists) return doc.data() as LadderStateRecord;
  } catch (err) {
    console.error("[DB] Failed to load ladder state:", err);
  }
  return null;
}

export async function saveLadderState(
  eventCode: string,
  season: string,
  category: string,
  state: LadderStateRecord,
): Promise<void> {
  if (!eventCode || !season || !category) return;
  const db = getDb();
  await db
    .collection("ladder_states")
    .doc(ladderHeaderKey(eventCode, season, category))
    .set(state, { merge: false });
}

// Returns each pair / quad of an elimination round with its finish order, so
// the Ladder Builder can auto-fill winner / runner-up into the next round.
export interface LadderRoundResultEntry {
  car: string;
  et: number | null;
  mph: number | null;
  // W / R / 3 / 4 from the timing system, when present. Auto-fill prefers
  // this over per-pair finish order so split / merged scrape pairs don't
  // change the answer.
  result: string | null;
}

export interface LadderRoundResultPair {
  cars: string[];
  finishOrder: LadderRoundResultEntry[];
  timestamp: string | null;
}

export async function getLadderRoundResults(
  eventCode: string,
  season: string,
  category: string,
  round: string,
): Promise<LadderRoundResultPair[]> {
  const allRuns = await getEventRuns(eventCode, season);
  const filtered = allRuns.filter(
    (r) => r.category === category && r.round === round,
  );
  if (filtered.length === 0) return [];

  const allTs = filtered.map((r) => r.timestamp).filter(Boolean) as string[];
  const tsGroups = buildTimestampGroups(allTs);
  const pairMap = new Map<string, RunRow[]>();
  for (const run of filtered) {
    if (!run.timestamp) continue;
    const canonical = tsGroups.get(run.timestamp) || run.timestamp;
    const arr = pairMap.get(canonical) || [];
    arr.push(run);
    pairMap.set(canonical, arr);
  }

  // Old corrupted scrape data sometimes collapses every run of a round onto
  // one canonical timestamp. Drag racing tops out at 4-wide, so any pair
  // with 5+ runs is split back into 2-car sub-pairs by walking adjacent
  // L / R runs in scrape order — same trick as the round-print page.
  const normalLane = (l: string | null | undefined): "L" | "R" | "X" => {
    const v = (l || "").trim().toUpperCase();
    if (v === "L" || v === "L1" || v === "1") return "L";
    if (v === "R" || v === "L2" || v === "2") return "R";
    return "X";
  };
  const scrapeOrderKey = (r: RunRow): string => {
    const seq = (r._scrape_seq ?? 1e9).toString().padStart(10, "0");
    return `${seq}|${r.timestamp || ""}`;
  };
  for (const [canonical, runs] of Array.from(pairMap.entries())) {
    if (runs.length <= 4) continue;
    const sorted = [...runs].sort((a, b) =>
      scrapeOrderKey(a).localeCompare(scrapeOrderKey(b)),
    );
    const subPairs: RunRow[][] = [];
    let cur: RunRow[] = [];
    const lanesUsed = new Set<"L" | "R" | "X">();
    for (const r of sorted) {
      const ln = normalLane(r.lane);
      if (cur.length >= 2 || (ln !== "X" && lanesUsed.has(ln))) {
        subPairs.push(cur);
        cur = [];
        lanesUsed.clear();
      }
      cur.push(r);
      lanesUsed.add(ln);
    }
    if (cur.length > 0) subPairs.push(cur);
    pairMap.delete(canonical);
    subPairs.forEach((subPair, idx) => {
      const firstTs = subPair[0]?.timestamp || canonical;
      pairMap.set(`${firstTs}#split-${idx}`, subPair);
    });
  }

  const dataScore = (r: RunRow): number => {
    let n = 0;
    if (r.rt != null) n++;
    if (r.ft60 != null) n++;
    if (r.ft1320 != null) n++;
    if (r.mph_1320 != null) n++;
    return n;
  };
  const resultPos = (res: string | null | undefined): number | null => {
    const r = (res || "").trim().toUpperCase();
    if (r === "W") return 1;
    if (r === "R") return 2;
    if (r === "3") return 3;
    if (r === "4") return 4;
    return null;
  };

  const results: LadderRoundResultPair[] = [];
  for (const [canonical, runs] of pairMap) {
    const byLaneCar = new Map<string, RunRow>();
    for (const run of runs) {
      const key = `${(run.lane || "").toUpperCase()}|${(run.car_number || "").trim()}`;
      const existing = byLaneCar.get(key);
      if (!existing || dataScore(run) > dataScore(existing)) {
        byLaneCar.set(key, run);
      }
    }
    const dedup = Array.from(byLaneCar.values()).filter(
      (r) => r.car_number && r.car_number.trim(),
    );
    if (dedup.length === 0) continue;

    const allHaveResult = dedup.every((r) => resultPos(r.result) !== null);
    let ordered: RunRow[];
    if (allHaveResult) {
      ordered = [...dedup].sort(
        (a, b) => (resultPos(a.result) || 99) - (resultPos(b.result) || 99),
      );
    } else {
      const finished = dedup.filter(
        (r) => r.ft1320 != null && r.ft1320 > 0 && !r.is_dq,
      );
      const unfinished = dedup.filter((r) => !finished.includes(r));
      finished.sort((a, b) => (a.ft1320 ?? 0) - (b.ft1320 ?? 0));
      ordered = [...finished, ...unfinished];
    }

    results.push({
      cars: dedup.map((r) => (r.car_number || "").trim()).filter(Boolean),
      finishOrder: ordered
        .filter((r) => r.car_number && r.car_number.trim())
        .map((r) => ({
          car: (r.car_number as string).trim(),
          et: r.ft1320,
          mph: r.mph_1320,
          result: r.result ?? null,
        })),
      timestamp: canonical,
    });
  }
  return results;
}

// ─── Class Eliminations (Stock / Super Stock) ─────────────────────────────
//
// Digests qualifying into the class-eliminations breakdown from the NHRA
// class elimination guide: every individual class designation with 2+ cars
// gets its own ladder; single-car classes fold into transmission combos.
// Pure classification/ladder logic lives in src/lib/class-elims.ts (shared
// with the client); this section handles run aggregation and the persisted
// per-event overrides (manual stick/auto calls, scratched cars).

export interface ClassElimConfig {
  // Manual stick/auto calls for singles whose class code doesn't encode the
  // transmission (keyed by car number).
  trans: Record<string, "auto" | "stick">;
  // Car numbers scratched from class (didn't make the call).
  excluded: string[];
}

export interface ClassElimCar {
  car_number: string;
  name: string;
  designation: string;
  et: number | null;         // best qualifying ET (furthest under index)
  index: number | null;      // class index for that run
  underOver: number | null;  // et - index (negative = under)
  bestRound: string | null;
  bestTimestamp: string | null;
  runCount: number;
  seed: number;              // position within its ladder group (1-based; 0 = unseeded)
  excluded: boolean;
  transmission: "auto" | "stick" | null;
  transSource: "designation" | "override" | "fixed" | null;
  combo: ComboAssignment | null; // set for singles routed to a combo
  noTime: boolean;               // no valid qualifying time recorded
}

export interface ClassElimGroup {
  designation: string;
  cars: ClassElimCar[];
}

export interface ClassElimCombo {
  key: string;
  label: string;
  cars: ClassElimCar[];
}

export interface ClassElimBreakdown {
  category: string;
  categoryKind: CategoryKind;
  roundsUsed: string[];
  totalCars: number;
  classes: ClassElimGroup[];     // designations with 2+ active cars → own ladder
  singles: ClassElimCar[];       // one-car classes (assigned or unresolved)
  combos: ClassElimCombo[];      // assembled combo ladders
  unresolved: ClassElimCar[];    // singles awaiting a stick/auto call
  noDesignation: ClassElimCar[]; // cars with runs but no class designation
  excludedCars: ClassElimCar[];  // scratched from class
  config: ClassElimConfig;
}

function classElimConfigDocId(eventCode: string, season: string, category: string): string {
  const cat = (category || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return `${eventCode}_${season}_${cat}`;
}

export async function getClassElimConfig(
  eventCode: string,
  season: string,
  category: string,
): Promise<ClassElimConfig> {
  try {
    const db = getDb();
    const doc = await db
      .collection("class_elim_configs")
      .doc(classElimConfigDocId(eventCode, season, category))
      .get();
    const data = doc.data() || {};
    return {
      trans: (data.trans as Record<string, "auto" | "stick">) || {},
      excluded: Array.isArray(data.excluded) ? data.excluded : [],
    };
  } catch (err) {
    console.error("[DB] Failed to load class elim config:", err);
    return { trans: {}, excluded: [] };
  }
}

export async function saveClassElimConfig(
  eventCode: string,
  season: string,
  category: string,
  config: ClassElimConfig,
): Promise<void> {
  const db = getDb();
  await db
    .collection("class_elim_configs")
    .doc(classElimConfigDocId(eventCode, season, category))
    .set(
      {
        event_code: eventCode,
        season,
        category,
        trans: config.trans || {},
        excluded: config.excluded || [],
        updated_at: new Date().toISOString(),
      },
      { merge: true },
    );
}

// Seeding: furthest under index first; index-less cars follow by raw ET;
// no-time cars go to the bottom (per NHRA: no qualifying run = bottom of
// ladder). Ties break to whoever posted the time first.
function classElimSeedSort(a: ClassElimCar, b: ClassElimCar): number {
  const rank = (c: ClassElimCar) => (c.underOver !== null ? 0 : c.et !== null ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.underOver !== null && b.underOver !== null && Math.abs(a.underOver - b.underOver) > 0.00001) {
    return a.underOver - b.underOver;
  }
  if (a.et !== null && b.et !== null && Math.abs(a.et - b.et) > 0.00001) {
    return a.et - b.et;
  }
  return (a.bestTimestamp || "").localeCompare(b.bestTimestamp || "");
}

export async function getClassElimBreakdown(
  eventCode: string,
  season: string,
  category: string,
  rounds?: string[],
): Promise<ClassElimBreakdown> {
  const allRuns = await getEventRuns(eventCode, season);
  tagRunTimestamps(allRuns);
  const catRuns = allRuns.filter((r) => r.category === category);

  // Default to qualifying rounds; fall back to time trials for events that
  // only log T sessions.
  let roundsUsed: string[];
  if (rounds && rounds.length > 0) {
    roundsUsed = rounds;
  } else {
    const qRounds = [...new Set(
      catRuns.map((r) => r.round).filter((rd): rd is string => !!rd && rd.startsWith("Q")),
    )].sort();
    roundsUsed = qRounds.length > 0
      ? qRounds
      : [...new Set(
          catRuns.map((r) => r.round).filter((rd): rd is string => !!rd && rd.startsWith("T")),
        )].sort();
  }
  const roundSet = new Set(roundsUsed);

  const kind = categoryKindFor(category);
  const config = await getClassElimConfig(eventCode, season, category);
  const excludedSet = new Set(config.excluded.map((c) => c.trim()));

  // Aggregate per car number across the selected rounds.
  interface Agg {
    car_number: string;
    name: string;
    designation: string;
    nameSeq: number;
    desigSeq: number;
    runCount: number;
    best: { et: number; index: number | null; diff: number | null; round: string; timestamp: string } | null;
  }
  const byCar = new Map<string, Agg>();
  let seq = 0;
  for (const run of catRuns) {
    if (!run.car_number) continue;
    const carNum = run.car_number.trim();
    if (!carNum) continue;
    seq++;
    let agg = byCar.get(carNum);
    if (!agg) {
      agg = { car_number: carNum, name: "", designation: "", nameSeq: -1, desigSeq: -1, runCount: 0, best: null };
      byCar.set(carNum, agg);
    }
    const order = run._scrape_seq ?? seq;
    if (run.name && order > agg.nameSeq) {
      agg.name = run.name;
      agg.nameSeq = order;
    }
    const desig = normalizeDesignation(run.class_index);
    if (desig && order > agg.desigSeq) {
      agg.designation = desig;
      agg.desigSeq = order;
    }

    if (!run.round || !roundSet.has(run.round)) continue;
    agg.runCount++;
    if (run.is_dq === 1 || run.ft1320 == null || run.ft1320 <= 0) continue;
    const index = run.dial_in && run.dial_in > 0 ? run.dial_in : null;
    const diff = index !== null ? run.ft1320 - index : null;
    const cand = {
      et: run.ft1320,
      index,
      diff,
      round: run.round,
      timestamp: run.timestamp || "",
    };
    const cur = agg.best;
    if (!cur) {
      agg.best = cand;
    } else if (diff !== null && cur.diff === null) {
      agg.best = cand;
    } else if (diff !== null && cur.diff !== null && diff < cur.diff) {
      agg.best = cand;
    } else if (diff === null && cur.diff === null && cand.et < cur.et) {
      agg.best = cand;
    }
  }

  const cars: ClassElimCar[] = [...byCar.values()]
    // Only cars that actually appeared in the selected qualifying rounds.
    .filter((a) => a.runCount > 0)
    .map((a) => ({
      car_number: a.car_number,
      name: a.name,
      designation: a.designation,
      et: a.best ? a.best.et : null,
      index: a.best ? a.best.index : null,
      underOver: a.best ? a.best.diff : null,
      bestRound: a.best ? a.best.round : null,
      bestTimestamp: a.best ? a.best.timestamp : null,
      runCount: a.runCount,
      seed: 0,
      excluded: excludedSet.has(a.car_number),
      transmission: null,
      transSource: null,
      combo: null,
      noTime: !a.best,
    }));

  const excludedCars = cars.filter((c) => c.excluded).sort(classElimSeedSort);
  const active = cars.filter((c) => !c.excluded);
  const noDesignation = active.filter((c) => !c.designation).sort(classElimSeedSort);

  // Group by designation.
  const groups = new Map<string, ClassElimCar[]>();
  for (const car of active) {
    if (!car.designation) continue;
    const list = groups.get(car.designation);
    if (list) list.push(car);
    else groups.set(car.designation, [car]);
  }

  const classes: ClassElimGroup[] = [];
  const singles: ClassElimCar[] = [];
  for (const [designation, list] of groups) {
    list.sort(classElimSeedSort);
    if (list.length >= 2) {
      list.forEach((c, i) => { c.seed = i + 1; });
      classes.push({ designation, cars: list });
    } else {
      singles.push(list[0]);
    }
  }
  classes.sort((a, b) => a.designation.localeCompare(b.designation));

  // Route singles into combos.
  const comboMap = new Map<string, ClassElimCombo>();
  const unresolved: ClassElimCar[] = [];
  for (const car of singles) {
    const fixed = fixedComboFor(car.designation, kind);
    let assignment: ComboAssignment | null = fixed;
    if (fixed) {
      car.transSource = "fixed";
    } else {
      const override = config.trans[car.car_number];
      const call = override || transmissionFromDesignation(car.designation, kind);
      if (call === "auto" || call === "stick") {
        car.transmission = call;
        car.transSource = override ? "override" : "designation";
        assignment = comboForTrans(call, kind);
      }
    }
    if (assignment) {
      car.combo = assignment;
      let combo = comboMap.get(assignment.key);
      if (!combo) {
        combo = { key: assignment.key, label: assignment.label, cars: [] };
        comboMap.set(assignment.key, combo);
      }
      combo.cars.push(car);
    } else {
      unresolved.push(car);
    }
  }

  const combos = [...comboMap.values()];
  for (const combo of combos) {
    combo.cars.sort(classElimSeedSort);
    combo.cars.forEach((c, i) => { c.seed = i + 1; });
  }
  combos.sort((a, b) => a.label.localeCompare(b.label));
  singles.sort(classElimSeedSort);
  unresolved.sort(classElimSeedSort);

  return {
    category,
    categoryKind: kind,
    roundsUsed,
    totalCars: active.length,
    classes,
    singles,
    combos,
    unresolved,
    noDesignation,
    excludedCars,
    config,
  };
}

// --------------- ET Finals Points D1 ---------------
// Team points for the Summit E.T. Finals / JDRL divisional championship.
// Rosters are stored per track (one document per team per season) and the
// main-race/buy-back class mapping is stored per event. The scoring itself
// lives in et-finals.ts so it stays pure and testable.

const ET_FINALS_ROSTERS = "et_finals_rosters";
const ET_FINALS_CONFIGS = "et_finals_configs";

function etRosterDocId(season: string, trackCode: string): string {
  const code = (trackCode || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "") || "UNKNOWN";
  return `${(season || "").trim()}_${code}`;
}

export async function saveEtFinalsRoster(roster: EtFinalsRoster): Promise<string> {
  const db = getDb();
  const id = etRosterDocId(roster.season, roster.track_code);
  // Replace rather than merge: a re-uploaded roster is the new truth, and a
  // merge would leave entries that were deleted from the sheet behind.
  await db.collection(ET_FINALS_ROSTERS).doc(id).set({ ...roster, id });
  return id;
}

export async function getEtFinalsRosters(season?: string): Promise<EtFinalsRoster[]> {
  try {
    const db = getDb();
    const snap = await db.collection(ET_FINALS_ROSTERS).get();
    const rosters: EtFinalsRoster[] = [];
    snap.forEach((doc) => {
      const data = doc.data() as EtFinalsRoster;
      if (season && (data.season || "").trim() !== season.trim()) return;
      rosters.push({ ...data, id: doc.id, entries: Array.isArray(data.entries) ? data.entries : [] });
    });
    rosters.sort((a, b) => (a.team_name || a.track_code).localeCompare(b.team_name || b.track_code));
    return rosters;
  } catch (err) {
    console.error("[DB] Failed to load ET Finals rosters:", err);
    return [];
  }
}

export async function deleteEtFinalsRoster(id: string): Promise<void> {
  const db = getDb();
  await db.collection(ET_FINALS_ROSTERS).doc(id).delete();
}

export async function getEtFinalsConfig(eventCode: string, season: string): Promise<EtFinalsConfig> {
  const fallback = emptyEtFinalsConfig();
  try {
    const db = getDb();
    const doc = await db.collection(ET_FINALS_CONFIGS).doc(`${eventCode}_${season}`).get();
    if (!doc.exists) return fallback;
    const data = doc.data() || {};
    return {
      categoryRoles: (data.categoryRoles as EtFinalsConfig["categoryRoles"]) || {},
      categoryDivision: (data.categoryDivision as EtFinalsConfig["categoryDivision"]) || {},
      buybackRounds: (data.buybackRounds as Record<string, string[]>) || {},
      pointsPerRoundWin: typeof data.pointsPerRoundWin === "number" && data.pointsPerRoundWin > 0
        ? data.pointsPerRoundWin
        : 1,
      manualMatches: (data.manualMatches as Record<string, string>) || {},
      eligibilityOverrides: (data.eligibilityOverrides as Record<string, boolean>) || {},
      scoringDates: Array.isArray(data.scoringDates) ? (data.scoringDates as string[]) : [],
    };
  } catch (err) {
    console.error("[DB] Failed to load ET Finals config:", err);
    return fallback;
  }
}

const ET_FINALS_CLASS_DEFAULTS = "et_finals_class_defaults";

/**
 * Remembered class setup, by class name, across every event in a season.
 * Without this each new race starts blank and the whole main-race / buy-back
 * mapping has to be redone, which is both tedious and easy to get wrong
 * mid-event. An event's own saved choices always win; these only fill the gaps.
 */
export interface EtFinalsClassDefaults {
  categoryRoles: Record<string, EtCategoryRole>;
  categoryDivision: Record<string, EtDivision>;
  buybackRounds: Record<string, string[]>;
}

export async function getEtFinalsClassDefaults(season: string): Promise<EtFinalsClassDefaults> {
  const empty: EtFinalsClassDefaults = { categoryRoles: {}, categoryDivision: {}, buybackRounds: {} };
  try {
    const db = getDb();
    const doc = await db.collection(ET_FINALS_CLASS_DEFAULTS).doc((season || "").trim()).get();
    if (!doc.exists) return empty;
    const data = doc.data() || {};
    return {
      categoryRoles: (data.categoryRoles as Record<string, EtCategoryRole>) || {},
      categoryDivision: (data.categoryDivision as Record<string, EtDivision>) || {},
      buybackRounds: (data.buybackRounds as Record<string, string[]>) || {},
    };
  } catch (err) {
    console.error("[DB] Failed to load ET Finals class defaults:", err);
    return empty;
  }
}

/**
 * Fold an event's explicit class choices into the season's remembered defaults,
 * so the next race at another track starts already configured. Merged rather
 * than replaced: a class this event didn't run keeps whatever it was last set
 * to elsewhere.
 */
async function rememberEtFinalsClassDefaults(season: string, config: EtFinalsConfig): Promise<void> {
  try {
    const existing = await getEtFinalsClassDefaults(season);
    const merged: EtFinalsClassDefaults = {
      categoryRoles: { ...existing.categoryRoles, ...(config.categoryRoles || {}) },
      categoryDivision: { ...existing.categoryDivision, ...(config.categoryDivision || {}) },
      buybackRounds: { ...existing.buybackRounds, ...(config.buybackRounds || {}) },
    };
    const db = getDb();
    await db
      .collection(ET_FINALS_CLASS_DEFAULTS)
      .doc((season || "").trim())
      .set({ season, ...merged, updated_at: new Date().toISOString() });
  } catch (err) {
    // Never fail the event's own save because the defaults couldn't be written.
    console.error("[DB] Failed to remember ET Finals class defaults:", err);
  }
}

export async function saveEtFinalsConfig(
  eventCode: string,
  season: string,
  config: EtFinalsConfig,
): Promise<void> {
  const db = getDb();
  await rememberEtFinalsClassDefaults(season, config);
  await db.collection(ET_FINALS_CONFIGS).doc(`${eventCode}_${season}`).set(
    {
      event_code: eventCode,
      season,
      categoryRoles: config.categoryRoles || {},
      categoryDivision: config.categoryDivision || {},
      buybackRounds: config.buybackRounds || {},
      pointsPerRoundWin: config.pointsPerRoundWin > 0 ? config.pointsPerRoundWin : 1,
      manualMatches: config.manualMatches || {},
      eligibilityOverrides: config.eligibilityOverrides || {},
      scoringDates: config.scoringDates || [],
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );
}

/**
 * Tech cards reshaped for the ET Finals matcher. Tech cards are the bridge
 * between a roster and the timing system: the member number is the only truly
 * stable identity, and the card also carries the personal car number a racer
 * may run instead of their roster-assigned one plus the track team they entered
 * under. Cards missing a member number are dropped — without it a card can't
 * anchor anything.
 */
async function buildEtTechCardRefs(): Promise<EtTechCardRef[]> {
  try {
    const cards = await getAllTechCards();
    const refs: EtTechCardRef[] = [];
    for (const card of cards) {
      const memberNumber = (card.member_number || "").trim();
      if (!memberNumber) continue;
      const name = [card.first_name, card.last_name].filter(Boolean).join(" ").trim();
      refs.push({
        memberNumber,
        trackTeam: (card.track_team || "").trim().toUpperCase(),
        carKey: normalizeCarKey(card.car_number),
        nameKey: normalizeNameKey(name),
        looseKey: looseNameKey(name),
      });
    }
    return refs;
  } catch (err) {
    console.error("[DB] Failed to build ET Finals tech card index:", err);
    return [];
  }
}

/**
 * Display names for track codes. A roster template often arrives with the track
 * name cell blank, and a tech card only ever gives the bare code, so the name a
 * team shows up under is editable rather than whatever the spreadsheet happened
 * to contain. Keyed by track code within one document per season.
 */
export interface EtTrackName {
  track_name: string;
  team_name: string;
}

const ET_FINALS_TRACKS = "et_finals_tracks";

export async function getEtFinalsTrackNames(season: string): Promise<Record<string, EtTrackName>> {
  try {
    const db = getDb();
    const doc = await db.collection(ET_FINALS_TRACKS).doc((season || "").trim()).get();
    const data = doc.data() || {};
    const tracks = (data.tracks as Record<string, EtTrackName>) || {};
    const out: Record<string, EtTrackName> = {};
    for (const [code, v] of Object.entries(tracks)) {
      out[code.trim().toUpperCase()] = {
        track_name: (v?.track_name || "").trim(),
        team_name: (v?.team_name || "").trim(),
      };
    }
    return out;
  } catch (err) {
    console.error("[DB] Failed to load ET Finals track names:", err);
    return {};
  }
}

export async function saveEtFinalsTrackNames(
  season: string,
  tracks: Record<string, EtTrackName>,
): Promise<void> {
  const db = getDb();
  const clean: Record<string, EtTrackName> = {};
  for (const [code, v] of Object.entries(tracks || {})) {
    const key = (code || "").trim().toUpperCase();
    if (!key) continue;
    const track_name = (v?.track_name || "").trim();
    const team_name = (v?.team_name || "").trim();
    // An entry with nothing in it is a deletion, not a blank override.
    if (!track_name && !team_name) continue;
    clean[key] = { track_name, team_name };
  }
  // Replace rather than merge, so clearing a name actually clears it.
  await db
    .collection(ET_FINALS_TRACKS)
    .doc((season || "").trim())
    .set({ season, tracks: clean, updated_at: new Date().toISOString() });
}

/** Re-key a roster onto a different track code, entries included. */
export async function recodeEtFinalsRoster(id: string, newTrackCode: string): Promise<string> {
  const code = (newTrackCode || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (!code) throw new Error("A track code is required");
  const db = getDb();
  const doc = await db.collection(ET_FINALS_ROSTERS).doc(id).get();
  if (!doc.exists) throw new Error("Roster not found");
  const roster = doc.data() as EtFinalsRoster;

  const entries = (roster.entries || []).map((e) => ({
    ...e,
    track_code: code,
    // The car number carries the track code, so it has to move with it.
    car_number: e.vehicle_number ? `${e.vehicle_number}${code}` : e.car_number,
  }));

  const updated: EtFinalsRoster = { ...roster, track_code: code, entries };
  const newId = await saveEtFinalsRoster(updated);
  if (newId !== id) await db.collection(ET_FINALS_ROSTERS).doc(id).delete();
  return newId;
}

/**
 * Every track code in play — the ones rosters were filed under plus the ones
 * only tech cards mention — so a code can be named before its roster arrives.
 */
export async function getEtFinalsTrackCodes(season: string): Promise<
  { code: string; hasRoster: boolean; techCardCount: number }[]
> {
  const [rosters, cards] = await Promise.all([getEtFinalsRosters(season), getAllTechCards()]);
  const codes = new Map<string, { hasRoster: boolean; techCardCount: number }>();
  const touch = (raw: string) => {
    const code = (raw || "").trim().toUpperCase();
    if (!code) return null;
    let e = codes.get(code);
    if (!e) codes.set(code, (e = { hasRoster: false, techCardCount: 0 }));
    return e;
  };
  for (const r of rosters) {
    const e = touch(r.track_code);
    if (e) e.hasRoster = true;
  }
  for (const c of cards) {
    const e = touch(c.track_team || "");
    if (e) e.techCardCount++;
  }
  return Array.from(codes.entries())
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export async function getEtFinalsStandings(
  eventCode: string,
  season: string,
): Promise<
  EtFinalsStandings & {
    config: EtFinalsConfig;
    rosterCount: number;
    trackNames: Record<string, EtTrackName>;
    trackCodes: { code: string; hasRoster: boolean; techCardCount: number }[];
    /** Classes configured from the season's remembered setup, not this event. */
    classesFromDefaults: string[];
  }
> {
  const [runs, rostersAll, savedConfig, trackNames, classDefaults] = await Promise.all([
    getEventRuns(eventCode, season),
    getEtFinalsRosters(),
    getEtFinalsConfig(eventCode, season),
    getEtFinalsTrackNames(season),
    getEtFinalsClassDefaults(season),
  ]);

  // Season defaults fill in classes this event hasn't been told about; the
  // event's own choices always win.
  const config: EtFinalsConfig = {
    ...savedConfig,
    categoryRoles: { ...classDefaults.categoryRoles, ...savedConfig.categoryRoles },
    categoryDivision: { ...classDefaults.categoryDivision, ...savedConfig.categoryDivision },
    buybackRounds: { ...classDefaults.buybackRounds, ...savedConfig.buybackRounds },
  };
  // Which classes are running on a remembered default rather than a choice made
  // for this event, so the page can say so instead of implying it was set here.
  const fromDefaults = Object.keys(classDefaults.categoryRoles).filter(
    (cat) => savedConfig.categoryRoles[cat] === undefined,
  );
  tagRunTimestamps(runs);

  // Prefer rosters filed under this season; fall back to every roster on file
  // so a season mismatch in a submitted template doesn't blank the standings.
  const seasonRosters = rostersAll.filter((r) => (r.season || "").trim() === (season || "").trim());
  const rosterSet = seasonRosters.length > 0 ? seasonRosters : rostersAll;

  // Apply the track directory before scoring, so the chosen names flow through
  // the standings, the drill-downs and the exports alike.
  const rosters = rosterSet.map((r) => {
    const override = trackNames[(r.track_code || "").trim().toUpperCase()];
    if (!override) return r;
    return {
      ...r,
      track_name: override.track_name || r.track_name,
      team_name: override.team_name || override.track_name || r.team_name,
    };
  });

  const [techCards, trackCodes] = await Promise.all([
    buildEtTechCardRefs(),
    getEtFinalsTrackCodes(season),
  ]);
  const standings = computeEtFinalsStandings(runs, rosters, config, techCards, trackNames);
  return {
    ...standings,
    config,
    rosterCount: rosters.length,
    trackNames,
    trackCodes,
    classesFromDefaults: fromDefaults,
  };
}
