import { getDb } from "./firebase-admin";

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
  place: string | null;
  category: string | null;
  lane: string | null;
  dial_in: number | null;
  event_code: string | null;
  event_name: string | null;
  event_type: string | null;
  season: string | null;
  start_date: string | null;
  created_at?: string;
  _dedup_key?: string;
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
}

const _cache = new Map<string, EventCache>();
const _loading = new Map<string, Promise<void>>();
const MAX_CACHED_EVENTS = 3;
const BATCH_SIZE = 400;

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
  if (existing) {
    existing.accessedAt = Date.now();
    return existing;
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

      const dedupMap = new Map<string, RunRow>();
      for (const run of rawRuns) {
        const dk = run._dedup_key || dedupKey(run);
        const existing = dedupMap.get(dk);
        if (!existing || (!hasTimingData(existing) && hasTimingData(run))) {
          dedupMap.set(dk, run);
        }
      }
      const runs = Array.from(dedupMap.values());
      backfillNames(runs);

      evictIfNeeded();

      const entry: EventCache = {
        runs,
        dedupKeys: new Set(runs.map((r) => r._dedup_key).filter(Boolean) as string[]),
        accessedAt: Date.now(),
      };
      _cache.set(key, entry);
      console.log(`[DB] Loaded ${runs.length} runs for ${key} from ${snap.size} batch docs`);
    } catch (err) {
      console.error(`[DB] Failed to load ${key}:`, err);
      _cache.set(key, { runs: [], dedupKeys: new Set(), accessedAt: Date.now() });
    }
    _loading.delete(key);
  })();

  _loading.set(key, loadPromise);
  await loadPromise;
  return _cache.get(key)!;
}

async function getEventRuns(eventCode: string, season: string): Promise<RunRow[]> {
  const cache = await ensureEventCache(eventCode, season);
  return cache.runs;
}

// --------------- Dedup ---------------

function dedupKey(run: Omit<RunRow, "id" | "created_at" | "_dedup_key">): string {
  return `${run.timestamp}|${run.car_number}|${run.round}|${run.lane}|${run.event_code}|${run.season}`;
}

function hasTimingData(run: RunRow | Omit<RunRow, "id" | "created_at" | "_dedup_key">): boolean {
  return run.rt != null || run.ft1320 != null || run.ft660 != null || run.ft60 != null;
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

export async function insertEvent(event: Omit<EventRow, "id" | "created_at">): Promise<void> {
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
        const changed = run.rt !== existing.rt || run.ft1320 !== existing.ft1320 ||
          run.ft660 !== existing.ft660 || run.ft60 !== existing.ft60 ||
          run.mph_1320 !== existing.mph_1320 || run.is_winner !== existing.is_winner ||
          (!existing.name && run.name);
        if (!changed) continue;
      }

      const row: RunRow = {
        ...run,
        _dedup_key: key,
        created_at: new Date().toISOString(),
      };
      if (existingIdx !== -1) cache.runs[existingIdx] = row;
      newRuns.push(row);
      continue;
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
    const chunk = newRuns.slice(i, i + BATCH_SIZE);
    await db.collection(path).add({
      runs: chunk.map((r) => ({ ...r })),
      count: chunk.length,
      created_at: new Date().toISOString(),
    });
  }

  backfillNames(cache.runs);

  console.log(`[DB] Inserted ${newRuns.length} new runs for ${eventKey(eventCode, season)} — ${cache.runs.length} total cached`);
  return newRuns.length;
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

export async function searchRacers(search: string, eventCode: string, season: string): Promise<{ name: string; car_number: string }[]> {
  const s = search.toLowerCase();
  const seen = new Map<string, string>();
  for (const r of await getEventRuns(eventCode, season)) {
    if (!r.name) continue;
    if (r.name.toLowerCase().includes(s) || (r.car_number && r.car_number.toLowerCase().includes(s))) {
      if (!seen.has(r.name)) {
        seen.set(r.name, r.car_number || "");
      }
    }
  }
  return Array.from(seen.entries())
    .map(([name, car_number]) => ({ name, car_number }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 50);
}

export async function getRacerRuns(name: string, eventCode: string, season: string): Promise<RunRow[]> {
  const runs = await getEventRuns(eventCode, season);
  tagRunTimestamps(runs);
  return runs
    .filter((r) => r.name === name)
    .sort((a, b) => tsSortKey(b.timestamp || "").localeCompare(tsSortKey(a.timestamp || "")));
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

  const recentRuns = [...validRuns]
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))
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

export async function getOpponentsForRuns(runs: RunRow[], eventCode: string, season: string): Promise<Map<string, RunRow[]>> {
  const timestamps = new Set(runs.map((r) => r.timestamp).filter(Boolean) as string[]);
  if (timestamps.size === 0) return new Map();

  const opponents = new Map<string, RunRow[]>();
  for (const run of await getEventRuns(eventCode, season)) {
    if (run.timestamp && timestamps.has(run.timestamp)) {
      const arr = opponents.get(run.timestamp) || [];
      arr.push(run);
      opponents.set(run.timestamp, arr);
    }
  }
  return opponents;
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

function parseTsToDate(ts: string): Date | null {
  try {
    const parts = ts.split(" ");
    const datePart = parts[0];
    const timePart = parts[1];
    const ampm = parts[2]?.toUpperCase();
    const [month, day, year] = datePart.split("/");
    const [hh, mm, ss] = timePart.split(":");
    let hour = parseInt(hh, 10);

    if (ampm === "PM" && hour !== 12) hour += 12;
    else if (ampm === "AM" && hour === 12) hour = 0;

    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      hour,
      parseInt(mm),
      parseInt(ss || "0")
    );
  } catch {
    return null;
  }
}

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

function raceDaySortKey(ts: string): number {
  const timePart = ts.split(" ")[1];
  if (!timePart) return 0;
  const [hh, mm, ss] = timePart.split(":").map(Number);
  const h24 = hh === 12 ? 12 : hh >= 6 ? hh : hh + 12;
  return h24 * 3600 + (mm || 0) * 60 + (ss || 0);
}

function tagRunTimestamps(runs: RunRow[], pmStart: boolean = false): void {
  for (const run of runs) {
    if (run.timestamp) run.timestamp = stripAmPm(run.timestamp);
  }

  const byDay = new Map<string, RunRow[]>();
  for (const run of runs) {
    if (!run.timestamp) continue;
    const day = run.timestamp.split(" ")[0];
    const arr = byDay.get(day) || [];
    arr.push(run);
    byDay.set(day, arr);
  }

  for (const [, dayRuns] of byDay) {
    dayRuns.sort((a, b) => raceDaySortKey(a.timestamp!) - raceDaySortKey(b.timestamp!));

    let passedNoon = pmStart;

    for (const run of dayRuns) {
      const timePart = run.timestamp!.split(" ")[1];
      if (!timePart) continue;
      const h = parseInt(timePart.split(":")[0], 10);

      if (h === 12) {
        passedNoon = true;
        run.timestamp = run.timestamp + " PM";
      } else if (passedNoon) {
        run.timestamp = run.timestamp + " PM";
      } else {
        run.timestamp = run.timestamp + " AM";
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
      return new Set(keys);
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

  const grouped = new Map<string, { timestamps: Map<string, Set<string>>; }>();

  eventRuns.forEach((run) => {
    if (!run.category || !run.round || !run.timestamp) return;
    const key = `${run.category}|||${run.round}`;
    const entry = grouped.get(key) || { timestamps: new Map<string, Set<string>>() };
    const uniqueRunKey =
      run._dedup_key ||
      `${run.timestamp}|${run.car_number || ""}|${run.lane || ""}|${run.name || ""}|${run.category}|${run.round}`;
    const tsRuns = entry.timestamps.get(run.timestamp) || new Set<string>();
    tsRuns.add(uniqueRunKey);
    entry.timestamps.set(run.timestamp, tsRuns);
    grouped.set(key, entry);
  });

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

export async function getLatestPair(eventCode: string, season: string): Promise<RunRow[]> {
  const runs = await getEventRuns(eventCode, season);
  tagRunTimestamps(runs);

  const withData = runs.filter((r) => r.timestamp && (r.rt != null || r.ft1320 != null || r.ft660 != null));
  if (withData.length === 0) return [];

  const sorted = [...withData].sort((a, b) => tsSortKey(b.timestamp!).localeCompare(tsSortKey(a.timestamp!)));
  const latestTs = sorted[0].timestamp;
  return sorted.filter((r) => r.timestamp === latestTs);
}
