import * as cheerio from "cheerio";
import type { TechCardEntry } from "./db";

const RF_BASE = "https://racefiles.nhradata.com";
const UA = "TiminData/1.0";

function nfetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-cache");
  if (!headers.has("User-Agent")) headers.set("User-Agent", UA);
  return fetch(input, { ...init, cache: "no-store", headers });
}

function extractCookies(headers: Headers): string {
  const setCookies = headers.getSetCookie?.() || [];
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

function mergeCookies(existing: string, newer: string): string {
  const map = new Map<string, string>();
  for (const part of [existing, newer].join("; ").split("; ")) {
    const [k, ...v] = part.split("=");
    if (k && k.trim()) map.set(k.trim(), v.join("="));
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

function cleanText(val: string | undefined): string {
  if (!val) return "";
  const t = val.replace(/ /g, " ").trim();
  return t === "&nbsp;" ? "" : t;
}

// Collect hidden inputs, text inputs, selected <option> values and checked
// checkboxes (posting the checkbox's value attribute, which ASP.NET CheckBoxList
// items require). Submit buttons are intentionally excluded — callers add the
// specific button they're "clicking".
function collectFormFields(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  $("input[type='hidden'], input[type='text']").each((_, el) => {
    const name = $(el).attr("name");
    if (name) fields[name] = ($(el).val() as string) || "";
  });
  $("select").each((_, el) => {
    const name = $(el).attr("name");
    if (name) fields[name] = ($(el).find("option:selected").val() as string) || "";
  });
  $("input[type='checkbox']").each((_, el) => {
    const name = $(el).attr("name");
    if (name && $(el).is(":checked")) fields[name] = ($(el).attr("value") as string) || "on";
  });
  return fields;
}

export class RacefilesAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RacefilesAuthError";
  }
}

function looksLikeLoginPage(html: string): boolean {
  return /type=["']password["']/i.test(html);
}

// Generic ASP.NET Forms-Authentication login. Hits a protected page, follows the
// redirect to the login form, auto-detects the username / password / submit
// fields, and posts the credentials. Returns the authenticated cookie string.
export async function racefilesLogin(username: string, password: string): Promise<string> {
  const protUrl = `${RF_BASE}/TCND1`;
  const first = await nfetch(protUrl, { redirect: "manual" });
  let cookies = extractCookies(first.headers);

  let loginUrl = protUrl;
  let loginHtml: string;
  if (first.status >= 300 && first.status < 400) {
    const loc = first.headers.get("location") || "/";
    loginUrl = new URL(loc, RF_BASE).toString();
    const lr = await nfetch(loginUrl, { headers: { Cookie: cookies } });
    cookies = mergeCookies(cookies, extractCookies(lr.headers));
    loginHtml = await lr.text();
  } else {
    loginHtml = await first.text();
  }

  if (!looksLikeLoginPage(loginHtml)) {
    // Already authenticated (cookie still valid) or unexpected page.
    if (!looksLikeLoginPage(loginHtml)) return cookies;
  }

  const $ = cheerio.load(loginHtml);
  const form = $("form").first();
  const action = form.attr("action") || loginUrl;
  const actionUrl = new URL(action, loginUrl).toString();

  const fields = collectFormFields(loginHtml);
  const userField = $("input[type='text']").first().attr("name")
    || $("input[type='email']").first().attr("name");
  const passField = $("input[type='password']").first().attr("name");
  if (!userField || !passField) {
    throw new RacefilesAuthError("Could not locate username/password fields on the racefiles login page.");
  }
  fields[userField] = username;
  fields[passField] = password;
  const submit = $("input[type='submit'], button[type='submit'], button:not([type])").first();
  const submitName = submit.attr("name");
  if (submitName) fields[submitName] = (submit.attr("value") as string) || "Login";

  const loginRes = await nfetch(actionUrl, {
    method: "POST",
    headers: { Cookie: cookies, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
  cookies = mergeCookies(cookies, extractCookies(loginRes.headers));

  const verify = await nfetch(protUrl, { headers: { Cookie: cookies } });
  const verifyHtml = await verify.text();
  if (looksLikeLoginPage(verifyHtml)) {
    throw new RacefilesAuthError("racefiles login failed — check the username and password.");
  }
  return cookies;
}

async function getTCND1(cookies: string): Promise<string> {
  const res = await nfetch(`${RF_BASE}/TCND1`, { headers: { Cookie: cookies } });
  return res.text();
}

async function postTCND1(cookies: string, fields: Record<string, string>): Promise<string> {
  const res = await nfetch(`${RF_BASE}/TCND1`, {
    method: "POST",
    headers: { Cookie: cookies, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return res.text();
}

// Set the Time Range filter to "1 Year" (postback) so the Events dropdown lists
// every event in range, then return both the resulting form fields and the
// parsed event list.
async function widenAndCollect(cookies: string): Promise<{ fields: Record<string, string>; events: string[] }> {
  let html = await getTCND1(cookies);
  if (looksLikeLoginPage(html)) throw new RacefilesAuthError("Session expired before listing events.");
  let fields = collectFormFields(html);
  fields["__EVENTTARGET"] = "ctl00$MainContent$DropDownList4";
  fields["__EVENTARGUMENT"] = "";
  fields["ctl00$MainContent$DropDownList4"] = "1 Year";
  html = await postTCND1(cookies, fields);
  fields = collectFormFields(html);
  return { fields, events: parseEventOptions(html) };
}

function parseEventOptions(html: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $("#MainContent_DropDownList1 option").each((_, el) => {
    const val = ($(el).attr("value") as string) || "";
    if (val.trim()) out.push(val);
  });
  return out;
}

export async function listTechCardEvents(cookies: string): Promise<string[]> {
  const { events } = await widenAndCollect(cookies);
  return events;
}

export type TechCardRow = Omit<TechCardEntry, "id">;

// GridView1 column order (see the rendered Tech Card Viewer table).
function parseTechCardGrid(html: string, eventName: string): TechCardRow[] {
  const $ = cheerio.load(html);
  const rows: TechCardRow[] = [];
  $("#MainContent_GridView1 tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 30) return; // header row (th) or layout rows
    const get = (i: number) => cleanText(cells.eq(i).text());
    const bodyMake = get(13);
    const bodyType = get(14);
    rows.push({
      car_number: get(6),
      first_name: get(2),
      last_name: get(3),
      street: "",
      city: "",
      state: "",
      zip: "",
      occupation: "",
      license_number: "",
      license_expiry: get(22),
      home_division: "",
      owner: "",
      crew_chief: "",
      category: get(7),
      class_name: get(8),
      engine_make: get(10),
      engine_year: get(11),
      body_type: [bodyMake, bodyType].filter(Boolean).join(" "),
      body_year: get(15),
      cu_cc: get(12),
      hp: get(16),
      factored_hp: get(17),
      member_number: get(1),
      member_expiry: get(23),
      payee: get(29),
      bio_lines: [],
      submission_date: get(24),
      uploaded_at: new Date().toISOString(),
      event_name: eventName,
    });
  });
  return rows;
}

export interface TechCardScrapeResult {
  event: string;
  entries: TechCardRow[];
  error?: string;
}

// Scrape the tech-card grid for each given event, reusing one authenticated
// session and evolving the ASP.NET ViewState across postbacks.
export async function scrapeTechCards(cookies: string, events: string[]): Promise<TechCardScrapeResult[]> {
  const results: TechCardScrapeResult[] = [];
  let { fields } = await widenAndCollect(cookies);

  for (const ev of events) {
    try {
      const f = { ...fields };
      f["__EVENTTARGET"] = "";
      f["__EVENTARGUMENT"] = "";
      f["ctl00$MainContent$DropDownList1"] = ev;
      f["ctl00$MainContent$DropDownList4"] = "1 Year";
      f["ctl00$MainContent$Button1"] = "Get Results / Refresh";
      const html = await postTCND1(cookies, f);
      if (looksLikeLoginPage(html)) throw new RacefilesAuthError("Session expired mid-scrape.");
      results.push({ event: ev, entries: parseTechCardGrid(html, ev) });
      fields = collectFormFields(html); // carry the refreshed ViewState forward
    } catch (err) {
      results.push({ event: ev, entries: [], error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
