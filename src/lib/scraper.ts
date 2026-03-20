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

export async function loginAndFetch(options: ScrapeOptions): Promise<Omit<RunRow, "id" | "created_at">[]> {
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
    return parseRunsFromHtml(dateHtml, options);
  }

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
      const span = cell.find("span");
      return span.length ? span.text().trim() : cell.text().trim();
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

  return runs;
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
