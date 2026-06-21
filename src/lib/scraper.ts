import * as cheerio from "cheerio";
import type { RunRow } from "./db";

const BASE_URL = "https://getresults.nhradata.com";

// Wrap fetch so every NHRA call opts out of Next.js's data cache and signals
// no-cache to upstream proxies. Without this Next.js may serve a previously-
// returned HTML page instead of re-hitting getresults, which is a primary
// reason "Refresh Data" sometimes returns yesterday's runs.
function nfetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-cache");
  if (!headers.has("Pragma")) headers.set("Pragma", "no-cache");
  return fetch(input, { ...init, cache: "no-store", headers });
}

function parseNum(val: string | undefined): number | null {
  if (!val || val.trim() === "" || val === "\u00a0" || val === "&nbsp;") return null;
  const n = parseFloat(val.trim());
  return isNaN(n) ? null : n;
}

function cleanText(val: string | undefined): string | null {
  if (!val || val.trim() === "" || val === "\u00a0" || val === "&nbsp;") return null;
  return val.trim();
}

export interface ScrapeOptions {
  username: string;
  password: string;
  season: string;
  eventType: string;
  eventCode: string;
  startDate: string;
  eventName: string;
  dateFilter?: string;
}

interface ViewStateFields {
  __VIEWSTATE: string;
  __VIEWSTATEGENERATOR: string;
  __EVENTVALIDATION: string;
  __EVENTTARGET?: string;
  __EVENTARGUMENT?: string;
}

function extractViewState(html: string): ViewStateFields {
  const $ = cheerio.load(html);
  return {
    __VIEWSTATE: $("#__VIEWSTATE").val() as string || "",
    __VIEWSTATEGENERATOR: $("#__VIEWSTATEGENERATOR").val() as string || "",
    __EVENTVALIDATION: $("#__EVENTVALIDATION").val() as string || "",
  };
}

// Session cache: reuse authenticated cookies + last-known form state across
// refreshes so scheduled polling skips the full login + dropdown navigation.
interface CachedSession {
  cookies: string;
  // Form fields (hidden inputs, selects) captured from the most recent
  // successful run-grid response. Used as a warm ViewState for the next poll.
  fields: Record<string, string>;
  selection: {
    eventType: string;
    eventCode: string;
    season: string;
    dateFilter: string;
  };
  expiresAt: number;
}

// Cap warm-session reuse at 2 min. With a long window the fast refresh kept
// replaying a cached session and could keep returning the same grid, so new
// runs lagged ("won't update all the time"); a short TTL forces a fresh full
// login often so polling reliably picks up new runs.
const SESSION_TTL_MS = 2 * 60 * 1000;
const _sessions = new Map<string, CachedSession>();

function sessionKey(username: string): string {
  return username.trim().toLowerCase();
}

function selectionMatches(cached: CachedSession["selection"], opts: ScrapeOptions): boolean {
  return cached.eventType === opts.eventType
    && cached.eventCode === opts.eventCode
    && cached.season === opts.season
    && cached.dateFilter === (opts.dateFilter || "");
}

export function invalidateSession(username: string): void {
  _sessions.delete(sessionKey(username));
}

function responseLooksLoggedOut(html: string): boolean {
  // The login form has a UsernameTextbox input; the dashboard never does.
  return html.includes("UsernameTextbox") || html.includes("PasswordTextbox");
}

async function tryFastRefresh(options: ScrapeOptions): Promise<Omit<RunRow, "id" | "created_at">[] | null> {
  const key = sessionKey(options.username);
  const session = _sessions.get(key);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    _sessions.delete(key);
    return null;
  }
  if (!selectionMatches(session.selection, options)) return null;

  const eventValue = `{ 'EventType' : '${options.eventType}', 'StartDate' : '${options.startDate}', 'EventCode' : '${options.eventCode}', 'Season' : '${options.season}' }`;

  // Re-trigger the event race dropdown postback against the cached ViewState
  // to force the server to re-render the run grid with fresh data.
  const fields = { ...session.fields };
  fields["__EVENTTARGET"] = "divEventRaceDropDown";
  fields["__EVENTARGUMENT"] = "";
  fields["yearDropDown"] = options.season;
  fields["eventTypeDropDown"] = options.eventType;
  fields["divEventRaceDropDown"] = eventValue;

  const res = await nfetch(`${BASE_URL}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": session.cookies,
      "User-Agent": "TiminData/1.0",
    },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });

  if (res.status >= 300 && res.status < 400) {
    _sessions.delete(key);
    return null;
  }

  let html = await res.text();
  if (responseLooksLoggedOut(html) || !html.includes("runGridView")) {
    _sessions.delete(key);
    return null;
  }

  if (options.dateFilter) {
    const dateFields = collectFormFields(html);
    dateFields["__EVENTTARGET"] = "dateDropDown";
    dateFields["__EVENTARGUMENT"] = "";
    dateFields["dateDropDown"] = options.dateFilter;

    const dateRes = await nfetch(`${BASE_URL}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": session.cookies,
        "User-Agent": "TiminData/1.0",
      },
      body: new URLSearchParams(dateFields).toString(),
    });
    html = await dateRes.text();
    if (responseLooksLoggedOut(html) || !html.includes("runGridView")) {
      _sessions.delete(key);
      return null;
    }
  }

  session.fields = collectFormFields(html);
  session.expiresAt = Date.now() + SESSION_TTL_MS;

  return parseRunsFromHtml(html, options);
}

function rememberSession(options: ScrapeOptions, cookies: string, finalHtml: string): void {
  _sessions.set(sessionKey(options.username), {
    cookies,
    fields: collectFormFields(finalHtml),
    selection: {
      eventType: options.eventType,
      eventCode: options.eventCode,
      season: options.season,
      dateFilter: options.dateFilter || "",
    },
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
}

export async function loginAndFetch(options: ScrapeOptions): Promise<Omit<RunRow, "id" | "created_at">[]> {
  try {
    const fast = await tryFastRefresh(options);
    if (fast !== null) {
      console.log(`[Scraper] Fast refresh hit for ${options.eventCode} (${fast.length} rows)`);
      return fast;
    }
  } catch (err) {
    console.log("[Scraper] Fast refresh failed, falling back to full login:", err instanceof Error ? err.message : err);
    invalidateSession(options.username);
  }

  const loginPageRes = await nfetch(`${BASE_URL}/login.aspx`, {
    redirect: "manual",
    headers: { "User-Agent": "TiminData/1.0" },
  });
  const loginHtml = await loginPageRes.text();
  const loginVS = extractViewState(loginHtml);

  const loginCookies = extractCookies(loginPageRes.headers);

  const loginBody = new URLSearchParams({
    __VIEWSTATE: loginVS.__VIEWSTATE,
    __VIEWSTATEGENERATOR: loginVS.__VIEWSTATEGENERATOR,
    __EVENTVALIDATION: loginVS.__EVENTVALIDATION,
    UsernameTextbox: options.username,
    PasswordTextbox: options.password,
    LoginButton: "Login",
  });

  const loginRes = await nfetch(`${BASE_URL}/login.aspx?ReturnUrl=%2f`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": loginCookies,
      "User-Agent": "TiminData/1.0",
    },
    body: loginBody.toString(),
    redirect: "manual",
  });

  const allCookies = mergeCookies(loginCookies, extractCookies(loginRes.headers));

  const eventValue = `{ 'EventType' : '${options.eventType}', 'StartDate' : '${options.startDate}', 'EventCode' : '${options.eventCode}', 'Season' : '${options.season}' }`;

  const pageRes = await nfetch(`${BASE_URL}/`, {
    headers: {
      "Cookie": allCookies,
      "User-Agent": "TiminData/1.0",
    },
  });
  const pageHtml = await pageRes.text();

  // First postback: select the event type to populate the event dropdown
  const typeFields = collectFormFields(pageHtml);
  typeFields["__EVENTTARGET"] = "eventTypeDropDown";
  typeFields["__EVENTARGUMENT"] = "";
  typeFields["yearDropDown"] = options.season;
  typeFields["eventTypeDropDown"] = options.eventType;

  const typeRes = await nfetch(`${BASE_URL}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": allCookies,
      "User-Agent": "TiminData/1.0",
    },
    body: new URLSearchParams(typeFields).toString(),
  });
  const typeHtml = await typeRes.text();

  // Second postback: select the specific event
  const eventFields = collectFormFields(typeHtml);
  eventFields["__EVENTTARGET"] = "divEventRaceDropDown";
  eventFields["__EVENTARGUMENT"] = "";
  eventFields["yearDropDown"] = options.season;
  eventFields["eventTypeDropDown"] = options.eventType;
  eventFields["divEventRaceDropDown"] = eventValue;

  const eventRes = await nfetch(`${BASE_URL}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": allCookies,
      "User-Agent": "TiminData/1.0",
    },
    body: new URLSearchParams(eventFields).toString(),
  });
  const eventHtml = await eventRes.text();

  if (options.dateFilter) {
    const dateFields = collectFormFields(eventHtml);
    dateFields["__EVENTTARGET"] = "dateDropDown";
    dateFields["__EVENTARGUMENT"] = "";
    dateFields["dateDropDown"] = options.dateFilter;

    const dateRes = await nfetch(`${BASE_URL}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": allCookies,
        "User-Agent": "TiminData/1.0",
      },
      body: new URLSearchParams(dateFields).toString(),
    });
    const dateHtml = await dateRes.text();
    rememberSession(options, allCookies, dateHtml);
    return parseRunsFromHtml(dateHtml, options);
  }

  rememberSession(options, allCookies, eventHtml);
  return parseRunsFromHtml(eventHtml, options);
}

// ----- Session-reusing helpers for bulk backfill -----
// loginAndFetch / fetchEventList each perform a full login per call, which is
// fine for one event but wasteful across thousands. These let a long-running
// backfill log in once and reuse the cookie for every list/scrape, navigating
// the ASP.NET dropdowns from a fresh GET each time. They throw "LOGGED_OUT"
// when the session has expired so the caller can re-login and retry.

const SESSION_EXPIRED = "LOGGED_OUT";

export class SessionExpiredError extends Error {
  constructor() {
    super(SESSION_EXPIRED);
    this.name = "SessionExpiredError";
  }
}

export async function nhraLogin(username: string, password: string): Promise<string> {
  const loginPageRes = await nfetch(`${BASE_URL}/login.aspx`, {
    redirect: "manual",
    headers: { "User-Agent": "TiminData/1.0" },
  });
  const loginHtml = await loginPageRes.text();
  const loginVS = extractViewState(loginHtml);
  const loginCookies = extractCookies(loginPageRes.headers);

  const loginRes = await nfetch(`${BASE_URL}/login.aspx?ReturnUrl=%2f`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": loginCookies,
      "User-Agent": "TiminData/1.0",
    },
    body: new URLSearchParams({
      __VIEWSTATE: loginVS.__VIEWSTATE,
      __VIEWSTATEGENERATOR: loginVS.__VIEWSTATEGENERATOR,
      __EVENTVALIDATION: loginVS.__EVENTVALIDATION,
      UsernameTextbox: username,
      PasswordTextbox: password,
      LoginButton: "Login",
    }).toString(),
    redirect: "manual",
  });

  const allCookies = mergeCookies(loginCookies, extractCookies(loginRes.headers));

  const pageRes = await nfetch(`${BASE_URL}/`, {
    headers: { "Cookie": allCookies, "User-Agent": "TiminData/1.0" },
  });
  const pageHtml = await pageRes.text();
  if (responseLooksLoggedOut(pageHtml)) {
    throw new Error("NHRA login failed. Double-check the username and password.");
  }
  return allCookies;
}

export async function listEventsWithCookies(
  cookies: string,
  season: string,
  eventType: string,
): Promise<NhraEvent[]> {
  const pageRes = await nfetch(`${BASE_URL}/`, {
    headers: { "Cookie": cookies, "User-Agent": "TiminData/1.0" },
  });
  const pageHtml = await pageRes.text();
  if (responseLooksLoggedOut(pageHtml)) throw new SessionExpiredError();

  const formData = collectFormFields(pageHtml);
  formData["__EVENTTARGET"] = "eventTypeDropDown";
  formData["__EVENTARGUMENT"] = "";
  formData["yearDropDown"] = season;
  formData["eventTypeDropDown"] = eventType;

  const postRes = await nfetch(`${BASE_URL}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": cookies,
      "User-Agent": "TiminData/1.0",
    },
    body: new URLSearchParams(formData).toString(),
  });
  const resultHtml = await postRes.text();
  if (responseLooksLoggedOut(resultHtml)) throw new SessionExpiredError();

  return parseEventDropdown(resultHtml);
}

export async function scrapeEventWithCookies(
  cookies: string,
  event: NhraEvent,
): Promise<Omit<RunRow, "id" | "created_at">[]> {
  const pageRes = await nfetch(`${BASE_URL}/`, {
    headers: { "Cookie": cookies, "User-Agent": "TiminData/1.0" },
  });
  const pageHtml = await pageRes.text();
  if (responseLooksLoggedOut(pageHtml)) throw new SessionExpiredError();

  const typeFields = collectFormFields(pageHtml);
  typeFields["__EVENTTARGET"] = "eventTypeDropDown";
  typeFields["__EVENTARGUMENT"] = "";
  typeFields["yearDropDown"] = event.season;
  typeFields["eventTypeDropDown"] = event.eventType;

  const typeRes = await nfetch(`${BASE_URL}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": cookies,
      "User-Agent": "TiminData/1.0",
    },
    body: new URLSearchParams(typeFields).toString(),
  });
  const typeHtml = await typeRes.text();
  if (responseLooksLoggedOut(typeHtml)) throw new SessionExpiredError();

  const eventValue = `{ 'EventType' : '${event.eventType}', 'StartDate' : '${event.startDate}', 'EventCode' : '${event.eventCode}', 'Season' : '${event.season}' }`;
  const eventFields = collectFormFields(typeHtml);
  eventFields["__EVENTTARGET"] = "divEventRaceDropDown";
  eventFields["__EVENTARGUMENT"] = "";
  eventFields["yearDropDown"] = event.season;
  eventFields["eventTypeDropDown"] = event.eventType;
  eventFields["divEventRaceDropDown"] = eventValue;

  const eventRes = await nfetch(`${BASE_URL}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": cookies,
      "User-Agent": "TiminData/1.0",
    },
    body: new URLSearchParams(eventFields).toString(),
  });
  const eventHtml = await eventRes.text();
  if (responseLooksLoggedOut(eventHtml)) throw new SessionExpiredError();

  return parseRunsFromHtml(eventHtml, {
    eventCode: event.eventCode,
    eventName: event.displayName,
    eventType: event.eventType,
    season: event.season,
    startDate: event.startDate,
  });
}

export function parseRunsFromHtml(
  html: string,
  meta: { eventCode: string; eventName: string; eventType: string; season: string; startDate: string }
): Omit<RunRow, "id" | "created_at">[] {
  const $ = cheerio.load(html);
  const runs: Omit<RunRow, "id" | "created_at">[] = [];

  const table = $("#runGridView");
  if (!table.length) {
    console.log("[Scraper] No #runGridView table found in HTML");
    console.log("[Scraper] Page title:", $("title").text());
    console.log("[Scraper] Tables on page:", $("table").length);
    console.log("[Scraper] HTML length:", html.length);
    const bodySnippet = $("body").text().slice(0, 500).replace(/\s+/g, " ");
    console.log("[Scraper] Body snippet:", bodySnippet);
    return runs;
  }

  const rows = table.find("tr").slice(1);
  let seq = 0;

  rows.each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 22) return;

    const getText = (i: number) => {
      const cell = cells.eq(i);
      const cellText = cell.text().trim();
      const span = cell.find("span");
      // Some cells render the value inside a <span>, but a sibling text node
      // sometimes carries extra info (e.g. an "AM/PM" marker after the
      // timestamp). Prefer the full cell text whenever it strictly contains
      // more than the span alone.
      if (span.length) {
        const spanText = span.text().trim();
        if (cellText.length > spanText.length) return cellText;
        return spanText;
      }
      return cellText;
    };

    const timestamp = cleanText(getText(0));
    const name = cleanText(getText(4));
    const car_number = cleanText(getText(3));

    if (!name && !car_number && !timestamp) return;

    runs.push({
      timestamp,
      round: cleanText(getText(1)),
      qual_pos: parseNum(getText(2)) as number | null,
      car_number,
      name,
      class_index: cleanText(getText(5)),
      rt: parseNum(getText(6)),
      ft60: parseNum(getText(7)),
      ft330: parseNum(getText(8)),
      ft660: parseNum(getText(9)),
      mph_660: parseNum(getText(10)),
      ft1000: parseNum(getText(11)),
      mph_1000: parseNum(getText(12)),
      ft1320: parseNum(getText(13)),
      mph_1320: parseNum(getText(14)),
      mov: parseNum(getText(15)),
      is_winner: getText(16) === "W" ? 1 : 0,
      is_dq: getText(17) !== "" && getText(17) !== null ? 1 : 0,
      result: cleanText(getText(16)),
      place: cleanText(getText(18)),
      category: cleanText(getText(19)),
      lane: cleanText(getText(20)),
      dial_in: parseNum(getText(21)),
      event_code: meta.eventCode,
      event_name: meta.eventName,
      event_type: meta.eventType,
      season: meta.season,
      start_date: meta.startDate,
      _scrape_seq: seq++,
    });
  });

  // CompuLink omits the AM/PM marker on bare timestamps. Infer it: race days
  // start in the morning, so each day starts in AM. Flip to PM the first time
  // we hit hour 12 (noon) or the hour suddenly drops (e.g. 11 -> 1, meaning
  // we crossed noon). Once flipped to PM we stay there for the rest of the
  // day. Pre-existing AM/PM tokens are respected.
  inferAmPm(runs);

  // Drop runs whose timestamp is clearly in the far future (NHRA pre-staging
  // placeholders). Use a 24h cushion against the server's clock so a track in
  // a different timezone or a brief clock skew doesn't cause us to drop
  // today's actually-already-happened runs.
  const now = new Date();
  const futureCutoff = now.getTime() + 24 * 60 * 60 * 1000;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (!runs[i].timestamp) continue;
    const ts = runs[i].timestamp!;
    const m = ts.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!m) continue;
    let h = parseInt(m[4], 10);
    const ap = (m[7] || "").toUpperCase();
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    const runDate = new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10), h, parseInt(m[5], 10), parseInt(m[6] || "0", 10));
    if (runDate.getTime() > futureCutoff) {
      runs.splice(i, 1);
    }
  }
  // Fix broken quad timestamps: in 4-wide racing, the NHRA timing system
  // sometimes posts the second pair (lanes 3&4) with a bogus future date or
  // time. The fixes below ONLY apply to category+rounds where we have direct
  // evidence of 4-wide structure (3+ runs at the same exact timestamp from a
  // legitimate quad). Without this gate the heuristics misfire on plain
  // 2-wide rounds and merge unrelated pairs together — which then shows up
  // as bogus extra rows on the round log sheet.
  const fourWideRounds = detectFourWideRounds(runs);
  const isFourWideRound = (r: { category: string | null; round: string | null }): boolean => {
    if (!r.category || !r.round) return false;
    return fourWideRounds.has(`${r.category}|${r.round}`);
  };

  // First pass: find the dominant date for each region of the data.
  // A run is an outlier if its date differs from the dominant date of the
  // surrounding ~20 runs.
  for (let i = 0; i < runs.length; i++) {
    const cur = runs[i];
    if (!cur.timestamp) continue;
    if (!isFourWideRound(cur)) continue;
    const curDay = cur.timestamp.split(" ")[0];

    // Count dates in a window around this run
    const windowStart = Math.max(0, i - 10);
    const windowEnd = Math.min(runs.length, i + 10);
    const dateCounts = new Map<string, number>();
    for (let w = windowStart; w < windowEnd; w++) {
      if (w === i || !runs[w].timestamp) continue;
      const d = runs[w].timestamp!.split(" ")[0];
      dateCounts.set(d, (dateCounts.get(d) || 0) + 1);
    }

    // Find the dominant date in the window
    let dominantDay = curDay;
    let maxCount = 0;
    for (const [d, n] of dateCounts) {
      if (n > maxCount) { dominantDay = d; maxCount = n; }
    }

    // If this run's date differs from the dominant date, it's an outlier
    if (curDay === dominantDay) continue;

    // Find the nearest earlier run of the same category + round on the
    // dominant date and use its timestamp
    for (let j = i - 1; j >= Math.max(0, i - 200); j--) {
      if (!runs[j].timestamp) continue;
      if (runs[j].category === cur.category && runs[j].round === cur.round) {
        const jDay = runs[j].timestamp!.split(" ")[0];
        if (jDay === dominantDay) {
          cur.timestamp = runs[j].timestamp;
          break;
        }
      }
    }
  }

  // Second fix: time outliers on the same day. If a small group of runs
  // (1-2 pairs) for a category/round is isolated by > 1 hour from the
  // main cluster of that category/round on the same day, it's a quad
  // second-pair with a bogus time. Fix it to match the main cluster.
  const byCatRound = new Map<string, typeof runs>();
  for (const run of runs) {
    if (!run.timestamp || !run.category || !run.round) continue;
    if (!isFourWideRound(run)) continue;
    const key = `${run.timestamp.split(" ")[0]}|${run.category}|${run.round}`;
    if (!byCatRound.has(key)) byCatRound.set(key, []);
    byCatRound.get(key)!.push(run);
  }

  for (const [, group] of byCatRound) {
    if (group.length < 6) continue; // need enough runs to identify a cluster
    // Parse all timestamps to minutes for comparison
    const withMin = group.map((r) => {
      const parts = r.timestamp!.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
      if (!parts) return { run: r, min: 0 };
      let h = parseInt(parts[1], 10);
      const m = parseInt(parts[2], 10);
      const ap = (parts[4] || "").toUpperCase();
      if (ap === "PM" && h !== 12) h += 12;
      if (ap === "AM" && h === 12) h = 0;
      return { run: r, min: h * 60 + m };
    });

    // Find the main cluster: sort by time, the cluster with the most runs
    const sorted = [...withMin].sort((a, b) => a.min - b.min);
    // Median time of the group
    const medianMin = sorted[Math.floor(sorted.length / 2)].min;

    for (const { run, min } of withMin) {
      // If this run is > 60 min from the median AND there are very few
      // runs near its time, it's an outlier
      if (Math.abs(min - medianMin) > 60) {
        const nearbyCount = withMin.filter((w) => Math.abs(w.min - min) <= 5).length;
        if (nearbyCount <= 4) {
          // Find the closest run to the median in this group and use its timestamp
          const closest = sorted.find((s) => Math.abs(s.min - medianMin) <= 5);
          if (closest) {
            run.timestamp = closest.run.timestamp;
          }
        }
      }
    }
  }

  return runs;
}

// A category+round is treated as 4-wide only if the scrape contains at least
// one timestamp shared by 3+ runs in that round — i.e. an actually-recorded
// quad. The broken-timestamp heuristics in parseRunsFromHtml only fire on
// rounds that pass this check, so 2-wide pairs aren't mis-merged when one
// pair runs unusually late or on an off day.
function detectFourWideRounds(
  runs: { timestamp: string | null; category: string | null; round: string | null }[],
): Set<string> {
  const counts = new Map<string, Map<string, number>>();
  for (const r of runs) {
    if (!r.timestamp || !r.category || !r.round) continue;
    const key = `${r.category}|${r.round}`;
    let inner = counts.get(key);
    if (!inner) {
      inner = new Map();
      counts.set(key, inner);
    }
    inner.set(r.timestamp, (inner.get(r.timestamp) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [key, inner] of counts) {
    for (const c of inner.values()) {
      if (c >= 3) {
        out.add(key);
        break;
      }
    }
  }
  return out;
}

interface MutableTimestampRow { timestamp: string | null }

function inferAmPm(rows: MutableTimestampRow[]): void {
  const TIME_RE = /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*$/i;
  const byDay = new Map<string, MutableTimestampRow[]>();
  for (const r of rows) {
    if (!r.timestamp) continue;
    const m = r.timestamp.trim().replace(/\s+/g, " ").match(TIME_RE);
    if (!m) continue;
    const day = m[1];
    const arr = byDay.get(day) || [];
    arr.push(r);
    byDay.set(day, arr);
  }

  const hourOf = (r: MutableTimestampRow): number | null => {
    const ts = (r.timestamp || "").trim().replace(/\s+/g, " ");
    const m = ts.match(TIME_RE);
    if (!m) return null;
    const h = parseInt(m[2], 10);
    return isNaN(h) ? null : h;
  };

  for (const [, dayRunsRaw] of byDay) {
    // CompuLink can list rows newest-first or oldest-first. We need to walk
    // them in chronological (oldest-first) order so the state machine flips
    // AM -> PM when we cross noon, not the reverse. Detect the direction by
    // counting how often hour increases vs decreases between adjacent rows;
    // if it decreases more often, reverse the array before walking.
    let dayRuns = dayRunsRaw;
    if (dayRuns.length >= 2) {
      let up = 0, down = 0;
      for (let i = 1; i < dayRuns.length; i++) {
        const a = hourOf(dayRuns[i - 1]);
        const b = hourOf(dayRuns[i]);
        if (a == null || b == null) continue;
        if (b > a) up++;
        else if (b < a) down++;
      }
      if (down > up) dayRuns = [...dayRunsRaw].reverse();
    }

    let state: "AM" | "PM" = "AM";
    let prevHour: number | null = null;
    let sawMorning = false;

    for (const r of dayRuns) {
      const ts = (r.timestamp || "").trim().replace(/\s+/g, " ");
      const m = ts.match(TIME_RE);
      if (!m) continue;
      const [, day, hhStr, mmStr, ssStr, apStr] = m;
      const hour = parseInt(hhStr, 10);
      if (isNaN(hour)) continue;

      if (apStr) {
        state = apStr.toUpperCase() as "AM" | "PM";
        if (state === "AM") sawMorning = true;
      } else {
        // Infer based on chronological progression.
        if (state === "AM") {
          if (hour === 12) {
            state = "PM";
          } else if (prevHour !== null && hour < prevHour) {
            // Hour dropped: we crossed noon (e.g. 11 -> 1).
            state = "PM";
          } else if (!sawMorning && (hour <= 7 || hour === 12)) {
            // The very first run of the day is too early to be morning racing
            // (hours 1-7) or is noon -> assume PM.
            state = "PM";
          } else {
            sawMorning = true;
          }
        }
        r.timestamp = `${day} ${hhStr}:${mmStr}${ssStr ? `:${ssStr}` : ""} ${state}`;
      }

      prevHour = hour;
    }
  }
}

function extractCookies(headers: Headers): string {
  const setCookies = headers.getSetCookie?.() || [];
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

function mergeCookies(existing: string, newer: string): string {
  const map = new Map<string, string>();
  for (const part of existing.split("; ")) {
    const [k, ...v] = part.split("=");
    if (k) map.set(k.trim(), v.join("="));
  }
  for (const part of newer.split("; ")) {
    const [k, ...v] = part.split("=");
    if (k) map.set(k.trim(), v.join("="));
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

export interface NhraEvent {
  eventType: string;
  startDate: string;
  eventCode: string;
  season: string;
  displayName: string;
}

export interface NhraEventDate {
  value: string;
  label: string;
}

export async function fetchEventList(
  username: string,
  password: string,
  season: string,
  eventType: string
): Promise<NhraEvent[]> {
  const loginPageRes = await nfetch(`${BASE_URL}/login.aspx`, {
    redirect: "manual",
    headers: { "User-Agent": "TiminData/1.0" },
  });
  const loginHtml = await loginPageRes.text();
  const loginVS = extractViewState(loginHtml);
  const loginCookies = extractCookies(loginPageRes.headers);

  const loginBody = new URLSearchParams({
    __VIEWSTATE: loginVS.__VIEWSTATE,
    __VIEWSTATEGENERATOR: loginVS.__VIEWSTATEGENERATOR,
    __EVENTVALIDATION: loginVS.__EVENTVALIDATION,
    UsernameTextbox: username,
    PasswordTextbox: password,
    LoginButton: "Login",
  });

  const loginRes = await nfetch(`${BASE_URL}/login.aspx?ReturnUrl=%2f`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": loginCookies,
      "User-Agent": "TiminData/1.0",
    },
    body: loginBody.toString(),
    redirect: "manual",
  });

  const allCookies = mergeCookies(loginCookies, extractCookies(loginRes.headers));

  const pageRes = await nfetch(`${BASE_URL}/`, {
    headers: { "Cookie": allCookies, "User-Agent": "TiminData/1.0" },
  });
  const pageHtml = await pageRes.text();

  if (responseLooksLoggedOut(pageHtml)) {
    throw new Error("NHRA login failed. Double-check the username and password.");
  }

  const formData = collectFormFields(pageHtml);
  formData["__EVENTTARGET"] = "eventTypeDropDown";
  formData["__EVENTARGUMENT"] = "";
  formData["yearDropDown"] = season;
  formData["eventTypeDropDown"] = eventType;

  const postRes = await nfetch(`${BASE_URL}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": allCookies,
      "User-Agent": "TiminData/1.0",
    },
    body: new URLSearchParams(formData).toString(),
  });
  const resultHtml = await postRes.text();

  if (responseLooksLoggedOut(resultHtml)) {
    throw new Error("NHRA login failed. Double-check the username and password.");
  }

  return parseEventDropdown(resultHtml);
}

function collectFormFields(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};

  $("input[type='hidden']").each((_, el) => {
    const name = $(el).attr("name");
    if (name) fields[name] = ($(el).val() as string) || "";
  });

  $("select").each((_, el) => {
    const name = $(el).attr("name");
    if (name) fields[name] = ($(el).find("option:selected").val() as string) || "";
  });

  $("input[type='checkbox']").each((_, el) => {
    const name = $(el).attr("name");
    if (name && $(el).is(":checked")) fields[name] = "on";
  });

  return fields;
}

export async function fetchEventDates(
  username: string,
  password: string,
  event: NhraEvent
): Promise<NhraEventDate[]> {
  const loginPageRes = await nfetch(`${BASE_URL}/login.aspx`, {
    redirect: "manual",
    headers: { "User-Agent": "TiminData/1.0" },
  });
  const loginHtml = await loginPageRes.text();
  const loginVS = extractViewState(loginHtml);
  const loginCookies = extractCookies(loginPageRes.headers);

  const loginRes = await nfetch(`${BASE_URL}/login.aspx?ReturnUrl=%2f`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": loginCookies,
      "User-Agent": "TiminData/1.0",
    },
    body: new URLSearchParams({
      ...loginVS, UsernameTextbox: username, PasswordTextbox: password, LoginButton: "Login",
    }).toString(),
    redirect: "manual",
  });
  const allCookies = mergeCookies(loginCookies, extractCookies(loginRes.headers));

  const pageRes = await nfetch(`${BASE_URL}/`, {
    headers: { "Cookie": allCookies, "User-Agent": "TiminData/1.0" },
  });
  const pageHtml = await pageRes.text();

  const typeFields = collectFormFields(pageHtml);
  typeFields["__EVENTTARGET"] = "eventTypeDropDown";
  typeFields["__EVENTARGUMENT"] = "";
  typeFields["yearDropDown"] = event.season;
  typeFields["eventTypeDropDown"] = event.eventType;

  const typeRes = await nfetch(`${BASE_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": allCookies, "User-Agent": "TiminData/1.0" },
    body: new URLSearchParams(typeFields).toString(),
  });
  const typeHtml = await typeRes.text();

  const eventValue = `{ 'EventType' : '${event.eventType}', 'StartDate' : '${event.startDate}', 'EventCode' : '${event.eventCode}', 'Season' : '${event.season}' }`;
  const eventFields = collectFormFields(typeHtml);
  eventFields["__EVENTTARGET"] = "divEventRaceDropDown";
  eventFields["__EVENTARGUMENT"] = "";
  eventFields["yearDropDown"] = event.season;
  eventFields["eventTypeDropDown"] = event.eventType;
  eventFields["divEventRaceDropDown"] = eventValue;

  const eventRes = await nfetch(`${BASE_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": allCookies, "User-Agent": "TiminData/1.0" },
    body: new URLSearchParams(eventFields).toString(),
  });
  const eventHtml = await eventRes.text();

  return parseDateDropdown(eventHtml);
}

function parseDateDropdown(html: string): NhraEventDate[] {
  const $ = cheerio.load(html);
  const dates: NhraEventDate[] = [];
  $("#dateDropDown option").each((_, el) => {
    const val = $(el).val() as string;
    const label = $(el).text().trim();
    if (val && val !== "--Select--") {
      dates.push({ value: val, label });
    }
  });
  return dates;
}

function parseEventDropdown(html: string): NhraEvent[] {
  const $ = cheerio.load(html);
  const events: NhraEvent[] = [];

  $("#divEventRaceDropDown option").each((_, el) => {
    const rawValue = $(el).attr("value") || "";
    const displayName = $(el).text().trim();
    if (!rawValue || rawValue === "--Select--" || rawValue === "--No Events--") return;

    try {
      const normalized = rawValue.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/'/g, '"');
      const parsed = JSON.parse(normalized);
      events.push({
        eventType: parsed.EventType || "",
        startDate: parsed.StartDate || "",
        eventCode: parsed.EventCode || "",
        season: parsed.Season || "",
        displayName,
      });
    } catch {
      const etMatch = rawValue.match(/EventType['"]\s*:\s*['"]([^'"]+)/);
      const sdMatch = rawValue.match(/StartDate['"]\s*:\s*['"]([^'"]+)/);
      const ecMatch = rawValue.match(/EventCode['"]\s*:\s*['"]([^'"]+)/);
      const snMatch = rawValue.match(/Season['"]\s*:\s*['"]([^'"]+)/);
      if (ecMatch) {
        events.push({
          eventType: etMatch?.[1] || "",
          startDate: sdMatch?.[1] || "",
          eventCode: ecMatch?.[1] || "",
          season: snMatch?.[1] || "",
          displayName,
        });
      }
    }
  });

  return events;
}
