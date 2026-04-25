import * as cheerio from "cheerio";
import type { RunRow } from "./db";

const BASE_URL = "https://getresults.nhradata.com";

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

const SESSION_TTL_MS = 10 * 60 * 1000;
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

function invalidateSession(username: string): void {
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

  const res = await fetch(`${BASE_URL}/`, {
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

    const dateRes = await fetch(`${BASE_URL}/`, {
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

  const loginPageRes = await fetch(`${BASE_URL}/login.aspx`, {
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

  const loginRes = await fetch(`${BASE_URL}/login.aspx?ReturnUrl=%2f`, {
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

  const pageRes = await fetch(`${BASE_URL}/`, {
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

  const typeRes = await fetch(`${BASE_URL}/`, {
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

  const eventRes = await fetch(`${BASE_URL}/`, {
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

    const dateRes = await fetch(`${BASE_URL}/`, {
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
    });
  });

  // CompuLink omits the AM/PM marker on bare timestamps. Infer it: race days
  // start in the morning, so each day starts in AM. Flip to PM the first time
  // we hit hour 12 (noon) or the hour suddenly drops (e.g. 11 -> 1, meaning
  // we crossed noon). Once flipped to PM we stay there for the rest of the
  // day. Pre-existing AM/PM tokens are respected.
  inferAmPm(runs);

  return runs;
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

  for (const [, dayRuns] of byDay) {
    let state: "AM" | "PM" = "AM";
    let prevHour: number | null = null;

    for (const r of dayRuns) {
      const ts = (r.timestamp || "").trim().replace(/\s+/g, " ");
      const m = ts.match(TIME_RE);
      if (!m) continue;
      const [, day, hhStr, mmStr, ssStr, apStr] = m;
      const hour = parseInt(hhStr, 10);
      if (isNaN(hour)) continue;

      if (apStr) {
        // Already labeled. Trust it and update state.
        state = apStr.toUpperCase() as "AM" | "PM";
      } else {
        // Infer based on chronological progression.
        if (state === "AM") {
          if (hour === 12) state = "PM";
          else if (prevHour !== null && hour < prevHour) state = "PM";
        }
        // Re-emit with the inferred marker.
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
  const loginPageRes = await fetch(`${BASE_URL}/login.aspx`, {
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

  const loginRes = await fetch(`${BASE_URL}/login.aspx?ReturnUrl=%2f`, {
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

  const pageRes = await fetch(`${BASE_URL}/`, {
    headers: { "Cookie": allCookies, "User-Agent": "TiminData/1.0" },
  });
  const pageHtml = await pageRes.text();

  const formData = collectFormFields(pageHtml);
  formData["__EVENTTARGET"] = "eventTypeDropDown";
  formData["__EVENTARGUMENT"] = "";
  formData["yearDropDown"] = season;
  formData["eventTypeDropDown"] = eventType;

  const postRes = await fetch(`${BASE_URL}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": allCookies,
      "User-Agent": "TiminData/1.0",
    },
    body: new URLSearchParams(formData).toString(),
  });
  const resultHtml = await postRes.text();

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
  const loginPageRes = await fetch(`${BASE_URL}/login.aspx`, {
    redirect: "manual",
    headers: { "User-Agent": "TiminData/1.0" },
  });
  const loginHtml = await loginPageRes.text();
  const loginVS = extractViewState(loginHtml);
  const loginCookies = extractCookies(loginPageRes.headers);

  const loginRes = await fetch(`${BASE_URL}/login.aspx?ReturnUrl=%2f`, {
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

  const pageRes = await fetch(`${BASE_URL}/`, {
    headers: { "Cookie": allCookies, "User-Agent": "TiminData/1.0" },
  });
  const pageHtml = await pageRes.text();

  const typeFields = collectFormFields(pageHtml);
  typeFields["__EVENTTARGET"] = "eventTypeDropDown";
  typeFields["__EVENTARGUMENT"] = "";
  typeFields["yearDropDown"] = event.season;
  typeFields["eventTypeDropDown"] = event.eventType;

  const typeRes = await fetch(`${BASE_URL}/`, {
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

  const eventRes = await fetch(`${BASE_URL}/`, {
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
