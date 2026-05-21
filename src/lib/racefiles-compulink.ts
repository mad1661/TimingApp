import * as cheerio from "cheerio";

const RF_BASE = "https://racefiles.nhradata.com";
const UA = "TiminData/1.0";

function nfetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
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

function looksLikeLoginPage(html: string): boolean {
  return /type=["']password["']/i.test(html);
}

export class RacefilesAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RacefilesAuthError";
  }
}

const CREATE_PATH = "/CreateCompulinkFile";

// Generic ASP.NET Forms-Authentication login for racefiles.nhradata.com (same
// credentials as the Tech Card Viewer). Hits the protected Create Compulink
// File page, follows the redirect to the sign-in form, auto-detects the
// username/password/submit fields, and posts the credentials.
export async function racefilesLogin(username: string, password: string): Promise<string> {
  const protUrl = `${RF_BASE}${CREATE_PATH}`;
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

  if (!looksLikeLoginPage(loginHtml)) return cookies;

  const $ = cheerio.load(loginHtml);
  const form = $("form").first();
  const actionUrl = new URL(form.attr("action") || loginUrl, loginUrl).toString();
  const fields = collectFormFields(loginHtml);
  const userField = $("input[type='text']").first().attr("name") || $("input[type='email']").first().attr("name");
  const passField = $("input[type='password']").first().attr("name");
  if (!userField || !passField) {
    throw new RacefilesAuthError("Could not locate the username/password fields on the racefiles login page.");
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
  if (looksLikeLoginPage(await verify.text())) {
    throw new RacefilesAuthError("racefiles login failed — check the username and password.");
  }
  return cookies;
}

async function getCreatePage(cookies: string): Promise<string> {
  const res = await nfetch(`${RF_BASE}${CREATE_PATH}`, { headers: { Cookie: cookies } });
  return res.text();
}

// Select an event type (DropDownList2) via postback so the event dropdown is
// populated and the ViewState is valid for that type. Returns the resulting
// form fields and the event option values.
async function selectEventType(cookies: string, eventType: string): Promise<{ fields: Record<string, string>; events: string[] }> {
  const html = await getCreatePage(cookies);
  if (looksLikeLoginPage(html)) throw new RacefilesAuthError("Session expired before listing events.");
  const fields = collectFormFields(html);
  fields["__EVENTTARGET"] = "ctl00$MainContent$DropDownList2";
  fields["__EVENTARGUMENT"] = "";
  fields["ctl00$MainContent$DropDownList2"] = eventType;
  const res = await nfetch(`${RF_BASE}${CREATE_PATH}`, {
    method: "POST",
    headers: { Cookie: cookies, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const resHtml = await res.text();
  const $ = cheerio.load(resHtml);
  const events: string[] = [];
  $("#MainContent_DropDownList1 option").each((_, el) => {
    const val = ($(el).attr("value") as string) || "";
    if (val.trim()) events.push(val);
  });
  return { fields: collectFormFields(resHtml), events };
}

export async function listCompulinkEvents(cookies: string, eventType: string): Promise<string[]> {
  const { events } = await selectEventType(cookies, eventType);
  return events;
}

// Click "Create File" for one event and return the generated .xlsx bytes.
// May take up to ~2 minutes server-side.
export async function downloadCompulinkExcel(
  cookies: string,
  eventType: string,
  event: string,
  includeJr: boolean,
): Promise<Buffer> {
  const { fields } = await selectEventType(cookies, eventType);
  fields["__EVENTTARGET"] = "";
  fields["__EVENTARGUMENT"] = "";
  fields["ctl00$MainContent$DropDownList2"] = eventType;
  fields["ctl00$MainContent$DropDownList1"] = event;
  if (includeJr) fields["ctl00$MainContent$CheckBox1"] = "on";
  else delete fields["ctl00$MainContent$CheckBox1"];
  fields["ctl00$MainContent$Button1"] = "Create File";

  const res = await nfetch(`${RF_BASE}${CREATE_PATH}`, {
    method: "POST",
    headers: { Cookie: cookies, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  // .xlsx is a zip archive — it must start with the "PK" magic bytes. Anything
  // else (e.g. an HTML error/login page) means the file wasn't produced.
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    const snippet = buf.toString("utf8", 0, 200).replace(/\s+/g, " ").trim();
    if (looksLikeLoginPage(buf.toString("utf8", 0, 4000))) throw new RacefilesAuthError("Session expired during file creation.");
    throw new Error(`Did not receive an Excel file for "${event}". Response began: ${snippet}`);
  }
  return buf;
}
