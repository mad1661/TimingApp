/**
 * Typed client for the official NHRA data API (api.nhra.com) and a mapper from
 * its paired (left/right) run schema into the app's per-lane `RunRow`.
 *
 * SERVER-ONLY. Reads the APIM subscription key from `process.env.NHRA_API_KEY`;
 * never import this from a client component.
 *
 * STATUS: groundwork. The endpoint catalog, auth, and the run-object schema are
 * derived from the developer portal + one sample payload. Anything marked
 * `TODO-verify` needs a real response to confirm before this replaces the
 * scraper. The API is firewalled from the sandbox (host_not_allowed), so this
 * is intentionally not yet wired into any route — see docs/nhra-api.md.
 *
 * Why this is a big win over scraper.ts:
 *  - The `name` field is a full 24-hour timestamp (YYYYMMDDHHMMSS), so the AM/PM
 *    that CompuLink omits — and that inferAmPm()/tagRunTimestamps() exist to
 *    reconstruct — is known exactly. We compute the correct marker directly.
 *  - Every car carries its NHRA member id (left/rightID), the stable identity
 *    the tech-cards/contacts system already keys on.
 */

import type { RunRow } from "./db";

const API_BASE = "https://api.nhra.com";

export type NhraEventType = "N" | "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7";

/** Session types for the /SessionType endpoint. */
export type NhraSessionType = "T" | "Q" | "C" | "E";

/**
 * One run object as returned by the Event API run endpoints (Runs, Full,
 * Category, Updated, Sessions). Each object describes one *pairing*; the two
 * lanes are embedded as `left*` / `right*`. Every value is a string; numbers
 * arrive as strings and empty fields as "".
 */
export interface NhraApiRunObject {
  name: string; // timestamp, YYYYMMDDHHMMSS (24-hour)
  category: string; // e.g. "TOP FUEL"
  rnd: string; // round, e.g. "Q1"
  bump: string; // TODO-verify: bump-spot value
  notes: string;

  leftQualPos: string;
  leftID: string; // NHRA member id
  leftCarNumber: string;
  leftName: string;
  leftClassIndex: string;
  leftDialIn: string;
  leftRT: string;
  left60ft: string;
  left330ft: string;
  left660ft: string;
  left660mph: string;
  left1000ft: string;
  left1000mph: string;
  left1320ft: string;
  left1320mph: string;
  leftFirst: string; // TODO-verify: margin/stripe vs package — not yet mapped
  leftMOV: string;
  leftWin: string; // "W" on the winning lane
  leftFlags: string; // DQ / foul markers

  rightQualPos: string;
  rightID: string;
  rightCarNumber: string;
  rightName: string;
  rightClassIndex: string;
  rightDialIn: string;
  rightRT: string;
  right60ft: string;
  right330ft: string;
  right660ft: string;
  right660mph: string;
  right1000ft: string;
  right1000mph: string;
  right1320ft: string;
  right1320mph: string;
  rightFirst: string;
  rightMOV: string;
  rightWin: string;
  rightFlags: string;

  partitionKey: string;
  rowKey: string;
}

/**
 * HMS (Health Monitoring System) event row. Documented fields below; the full
 * shape is unconfirmed.
 * TODO-verify: the event-identity fields (EventType, StartDate, EventCode,
 * name) — these are the bridge from the app's event_code+season model to the
 * Event API's EventType+StartDate keys.
 */
export interface HmsEvent {
  /** 0 archived, +# active, -# on hold, +/-# started. The sign is the state. */
  IsRunning?: number | string;
  /** The class currently on the track. */
  Category?: string;
  [key: string]: unknown;
}

/** Event context the run objects don't carry; supplied by the caller (from HMS). */
export interface NhraApiEventMeta {
  eventCode: string;
  eventName: string;
  eventType: string;
  season: string;
  startDate: string;
}

export class NhraApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "NhraApiError";
  }
}

function apiKey(): string {
  const key = process.env.NHRA_API_KEY;
  if (!key) {
    throw new Error(
      "NHRA_API_KEY is not set — add it as a secret/env var (see docs/nhra-api.md).",
    );
  }
  return key;
}

/**
 * Core GET. Sends the APIM subscription key and, by default, `Cache-Control:
 * no-cache` so APIM serves fresh data (mirrors the app's force-dynamic/no-store
 * stance that fixes "Refresh returns yesterday's runs"). Pass `noCache: false`
 * on the slow, semi-static endpoints to let APIM's response cache do its job.
 */
async function nhraApiGet<T>(
  path: string,
  opts: { noCache?: boolean; query?: Record<string, string | undefined> } = {},
): Promise<T> {
  let url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  if (opts.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== "") qs.set(k, v);
    }
    const q = qs.toString();
    if (q) url += (url.includes("?") ? "&" : "?") + q;
  }

  const headers: Record<string, string> = {
    "Ocp-Apim-Subscription-Key": apiKey(),
    Accept: "application/json",
  };
  if (opts.noCache !== false) headers["Cache-Control"] = "no-cache";

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new NhraApiError(res.status, url, `NHRA API ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** "TOP FUEL" -> "TOP_FUEL" for the /Category path segment. */
export function categoryToPath(category: string): string {
  return category.trim().toUpperCase().replace(/\s+/g, "_");
}

/**
 * Normalize a stored start date to the API's `YYYYMMDD` path segment. The live
 * config carries whatever the getresults dropdown used (already YYYYMMDD in
 * practice), but accept ISO / US forms defensively so the API path is robust.
 */
export function toApiStartDate(startDate: string): string {
  const s = startDate.trim();
  if (/^\d{8}$/.test(s)) return s; // already YYYYMMDD
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (iso) return `${iso[1]}${iso[2].padStart(2, "0")}${iso[3].padStart(2, "0")}`;
  const us = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (us) return `${us[3]}${us[1].padStart(2, "0")}${us[2].padStart(2, "0")}`;
  return s.replace(/\D/g, "").slice(0, 8); // fallback: first 8 digits
}

// --------------------------------------------------------------------------
// Event API
// --------------------------------------------------------------------------

/** Latest N runs — live poll endpoint (45s server cache). */
export function getLatestRuns(
  eventType: NhraEventType,
  startDate: string,
  count: number,
): Promise<NhraApiRunObject[]> {
  return nhraApiGet(`/event/EventType/${eventType}/StartDate/${startDate}/Count/${count}`);
}

/** Recently *changed* runs (corrections, added ETs) — live poll (45s cache). */
export function getUpdatedRuns(
  eventType: NhraEventType,
  startDate: string,
  count: number,
): Promise<NhraApiRunObject[]> {
  return nhraApiGet(
    `/event/EventType/${eventType}/StartDate/${startDate}/Updated/Count/${count}`,
  );
}

/** Entire event (15min cache). Optional partial/complete racer-name filter. */
export function getFullEvent(
  eventType: NhraEventType,
  startDate: string,
  racer?: string,
): Promise<NhraApiRunObject[]> {
  return nhraApiGet(`/event/EventType/${eventType}/StartDate/${startDate}`, {
    noCache: false,
    query: { racer },
  });
}

/**
 * Entire event, time-sliced (15min cache).
 * TODO-verify: response shape — timeslip-formatted vs. time-filtered Full.
 */
export function getEventSlips(
  eventType: NhraEventType,
  startDate: string,
  timestamp?: string, // YYYYMMDDhhmmss
): Promise<unknown> {
  return nhraApiGet(`/event/EventType/${eventType}/StartDate/${startDate}/Slips`, {
    noCache: false,
    query: { timestamp },
  });
}

/** One category's runs (30min cache). carnumber accepts a comma list ("41,44"). */
export function getCategoryRuns(
  eventType: NhraEventType,
  startDate: string,
  category: string,
  filters: { racer?: string; carnumber?: string } = {},
): Promise<NhraApiRunObject[]> {
  return nhraApiGet(
    `/event/EventType/${eventType}/StartDate/${startDate}/Category/${categoryToPath(category)}`,
    { noCache: false, query: { racer: filters.racer, carnumber: filters.carnumber } },
  );
}

/**
 * Categories that ran at the event (30min cache).
 * TODO-verify: response shape (likely a string[] of category names).
 */
export function getCategories(
  eventType: NhraEventType,
  startDate: string,
): Promise<unknown> {
  return nhraApiGet(`/event/EventType/${eventType}/StartDate/${startDate}/Categories`, {
    noCache: false,
  });
}

/** Runs by session (30min cache). See the portal for valid filter combinations. */
export function getSessions(
  eventType: NhraEventType,
  startDate: string,
  sessionType: NhraSessionType,
  filters: { category?: string; round?: string; racer?: string; carnumber?: string } = {},
): Promise<NhraApiRunObject[]> {
  return nhraApiGet(
    `/event/EventType/${eventType}/StartDate/${startDate}/SessionType/${sessionType}`,
    {
      noCache: false,
      query: {
        category: filters.category ? categoryToPath(filters.category) : undefined,
        round: filters.round,
        racer: filters.racer,
        carnumber: filters.carnumber,
      },
    },
  );
}

/**
 * Detected category winners and runner-ups (30min cache).
 * TODO-verify: response shape.
 */
export function getWinners(
  eventType: NhraEventType,
  startDate: string,
): Promise<unknown> {
  return nhraApiGet(`/event/EventType/${eventType}/StartDate/${startDate}/Winners`, {
    noCache: false,
  });
}

/**
 * Entry list. Note the different path/auth surface (`event/apiauth/api/...`)
 * and that it takes only an optional StartDate, no EventType.
 * TODO-verify: response shape + whether the apiauth path needs different auth.
 */
export function getEntryList(startDate?: string): Promise<unknown> {
  return nhraApiGet(`/event/apiauth/api/entrylist`, {
    noCache: false,
    query: { StartDate: startDate },
  });
}

// --------------------------------------------------------------------------
// HMS API (discovery + live status)
// --------------------------------------------------------------------------

/** Events live right now (2min cache). */
export function getActiveEvents(): Promise<HmsEvent[]> {
  return nhraApiGet(`/hms/Active`);
}

/** Every event for a year with live status (15min cache). Defaults to current year. */
export function getHmsEvents(year?: string): Promise<HmsEvent[]> {
  return nhraApiGet(`/hms/`, { query: { year } });
}

/** EventType listing for the current year. */
export function getHmsEventTypes(eventType?: NhraEventType): Promise<unknown> {
  return nhraApiGet(`/hms/EventType`, { query: { eventType } });
}

/** Current-season national event feed. */
export function getNationalEventList(): Promise<unknown> {
  return nhraApiGet(`/NationalEventList`, { noCache: false });
}

// --------------------------------------------------------------------------
// Mapper: API paired objects -> per-lane RunRow[]
// --------------------------------------------------------------------------

function strOrNull(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

/** Parse a numeric string ("", ".087", "-.030", "286.50") to number | null. */
function apiNum(v: string): number | null {
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert a YYYYMMDDHHMMSS name into the app's `M/D/YYYY h:mm:ss AM/PM` string
 * (and a Date for ordering). Built through a Date so the 4-wide artifact — the
 * 2nd pair is the 1st + 1s and can read as SS=60 — normalizes into a valid
 * instant automatically (e.g. 30:60 -> 31:00, still within the 1s tolerance
 * that buildTimestampGroups() uses to merge quad pairs). Because the source is
 * 24-hour, the AM/PM marker is computed exactly, not inferred.
 */
export function parseApiTimestamp(name: string): { date: Date; formatted: string } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(name.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  const date = new Date(+y, +mo - 1, +d, +hh, +mm, +ss);
  if (Number.isNaN(date.getTime())) return null;

  const h24 = date.getHours();
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const pad = (n: number) => String(n).padStart(2, "0");
  const formatted =
    `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ` +
    `${h12}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${ampm}`;
  return { date, formatted };
}

type ApiRow = Omit<RunRow, "id" | "created_at">;

/** Build one per-lane RunRow from one side of a paired object, or null if empty. */
function mapLane(
  obj: NhraApiRunObject,
  side: "left" | "right",
  timestamp: string | null,
  meta: NhraApiEventMeta,
): ApiRow | null {
  const field = (suffix: string): string => {
    const v = obj[`${side}${suffix}` as keyof NhraApiRunObject];
    return typeof v === "string" ? v : "";
  };

  const car_number = strOrNull(field("CarNumber"));
  const name = strOrNull(field("Name"));
  const memberId = strOrNull(field("ID"));
  const rt = apiNum(field("RT"));
  const ft60 = apiNum(field("60ft"));
  const ft330 = apiNum(field("330ft"));
  const ft660 = apiNum(field("660ft"));
  const ft1000 = apiNum(field("1000ft"));
  const ft1320 = apiNum(field("1320ft"));

  // Skip a lane only when it has neither an identity nor any timing data
  // (mirrors parseRunsFromHtml's empty-row guard). A solo/bye lane with timing
  // but no name is still a real run.
  const hasIdentity = car_number != null || name != null || memberId != null;
  const hasTiming =
    rt != null || ft60 != null || ft330 != null || ft660 != null || ft1000 != null || ft1320 != null;
  if (!hasIdentity && !hasTiming) return null;

  const win = field("Win").trim();
  const flags = field("Flags").trim();

  return {
    timestamp,
    round: strOrNull(obj.rnd),
    qual_pos: apiNum(field("QualPos")),
    car_number,
    name,
    class_index: strOrNull(field("ClassIndex")),
    rt,
    ft60,
    ft330,
    ft660,
    mph_660: apiNum(field("660mph")),
    ft1000,
    mph_1000: apiNum(field("1000mph")),
    ft1320,
    mph_1320: apiNum(field("1320mph")),
    mov: apiNum(field("MOV")),
    is_winner: win === "W" ? 1 : 0,
    // TODO-verify: leftFlags vocabulary. Mirrors the scraper's "non-empty DQ
    // column -> is_dq" until the flag set is confirmed.
    is_dq: flags !== "" ? 1 : 0,
    result: win === "" ? null : win,
    place: null, // TODO-verify: no direct API field
    category: strOrNull(obj.category),
    // TODO-verify: lane string parity with the scraper. The dedup key includes
    // lane, so confirm against real scraped data before mixing sources for the
    // same event. For 4-wide, the 2nd pair (1s later) reuses Left/Right.
    lane: side === "left" ? "Left" : "Right",
    dial_in: apiNum(field("DialIn")),
    event_code: meta.eventCode,
    event_name: meta.eventName,
    event_type: meta.eventType,
    season: meta.season,
    start_date: meta.startDate,
  };
}

/**
 * Map Event API run objects into per-lane RunRows ready for insertRuns().
 * Splits each paired object into up to two rows and assigns `_scrape_seq` in
 * true chronological order (oldest first) — the API returns newest-first, but
 * tagRunTimestamps() walks by ascending scrape sequence.
 */
export function mapApiRunsToRunRows(
  apiRuns: NhraApiRunObject[],
  meta: NhraApiEventMeta,
): ApiRow[] {
  const built: { row: ApiRow; sortMs: number; laneOrder: number }[] = [];

  for (const obj of apiRuns) {
    const ts = parseApiTimestamp(obj.name);
    const timestamp = ts?.formatted ?? null;
    const sortMs = ts?.date.getTime() ?? 0;

    const left = mapLane(obj, "left", timestamp, meta);
    if (left) built.push({ row: left, sortMs, laneOrder: 0 });
    const right = mapLane(obj, "right", timestamp, meta);
    if (right) built.push({ row: right, sortMs, laneOrder: 1 });
  }

  built.sort((a, b) => a.sortMs - b.sortMs || a.laneOrder - b.laneOrder);
  built.forEach((b, i) => {
    b.row._scrape_seq = i;
  });

  return built.map((b) => b.row);
}

/**
 * High-level live fetch, symmetric with the scraper's scrapeEventWithCookies():
 * pull the full current event from the API and map it to RunRows ready for
 * insertRuns(). Forces no-cache for freshness. The rows keep meta.startDate
 * as-is so they match scraper-produced rows for the same event; only the
 * request URL is normalized to YYYYMMDD.
 *
 * Uses Full (entire event) for parity with the scraper's "fetch everything,
 * dedupe" model. The lighter live alternative is /Count + /Updated/Count.
 */
export async function fetchEventRunsViaApi(meta: NhraApiEventMeta): Promise<ApiRow[]> {
  const objs = await nhraApiGet<NhraApiRunObject[]>(
    `/event/EventType/${meta.eventType}/StartDate/${toApiStartDate(meta.startDate)}`,
    { noCache: true },
  );
  return mapApiRunsToRunRows(objs, meta);
}
