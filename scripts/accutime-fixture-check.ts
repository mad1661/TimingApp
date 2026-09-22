/**
 * Regression fixture for the AccuTime parser — no test framework in this repo,
 * so this is a plain script: `npx tsx scripts/accutime-fixture-check.ts`.
 * Exits non-zero on the first failed check.
 *
 * Covers the v1.41.1 fixes: Class.ini [Menu] → FC resolves to FUNNY CAR, a
 * missing ini never falls back to the Secure "X" placeholder, the page's class
 * pick fills a classless session, the series title reads from [Reports], and a
 * two-class loose drop splits into two sessions (by name stem and by folder).
 */
import { parseAccuTimePack, parseClassIni } from "../src/lib/accutime";
import { buildAccuTimeArtifacts } from "../src/lib/accutime-export";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const latin1 = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));

// Class.ini in the sample session's shape (GM1 Funny Car).
const FC_INI = [
  "[Menu]",
  "10=3",
  "11=FC",
  "[Race Date]",
  "0=20260918084551",
  "[Reports]",
  "3=1",
  "7=NHRA Mission Foods Drag Racing Series",
  "[Round Number]",
  "0=1",
].join("\r\n");

const TF_INI = FC_INI.replace("11=FC", "11=TF");

// Minimal .qly: 18 comma-separated fields per row; the parser reads
// f[4]=session, f[11]=name, f[12]=car, f[15]=rt, f[16]=et, f[17]=mph.
function qly(rows: [string, string, string, string, string][]): Uint8Array {
  const lines = rows.map(([name, car, rt, et, mph]) =>
    ["", "", "", "", "1", "", "", "", "", "", "", name, car, "", "", rt, et, mph].join(","),
  );
  return latin1(lines.join("\r\n"));
}

const FC_QLY = qly([
  ["Ron Capps", "28", "0.4959", "3.905", "329.34"],
  ["Austin Prock", "271", "0.4890", "3.889", "331.45"],
]);
const TF_QLY = qly([
  ["Doug Kalitta", "1", "0.4520", "3.702", "334.15"],
  ["Steve Torrence", "41", "0.4611", "3.699", "336.57"],
]);

// ——— 1. parseClassIni on the sample shape ———
{
  const ini = parseClassIni(FC_INI);
  check("Class.ini [Menu] 11=FC → classCode FC", ini.classCode === "FC", `got "${ini.classCode}"`);
  check(
    "Class.ini [Reports] → series title",
    ini.seriesName === "NHRA Mission Foods Drag Racing Series",
    `got "${ini.seriesName}"`,
  );
  check("Class.ini [Race Date] → 2026-09-18", ini.raceDate === "2026-09-18", `got "${ini.raceDate}"`);
}

// ——— 2. Full session with ini: FC resolves to the class NAME ———
{
  const { sessions } = parseAccuTimePack([
    { name: "race.qly", data: FC_QLY },
    { name: "Class.ini", data: latin1(FC_INI) },
  ]);
  check("session with ini: one session", sessions.length === 1, `got ${sessions.length}`);
  check("classCode FC", sessions[0]?.classCode === "FC", `got "${sessions[0]?.classCode}"`);
  check("className FUNNY CAR", sessions[0]?.className === "FUNNY CAR", `got "${sessions[0]?.className}"`);

  const artifacts = buildAccuTimeArtifacts(sessions, []);
  const qdat = artifacts.qdat[0]?.content || "";
  check("QDAT header carries the class name", qdat.includes("FUNNY CAR"), qdat.split("\n")[0]);
}

// ——— 3. Missing ini: never X / SECURE; the page's pick fills it ———
{
  const { sessions } = parseAccuTimePack([{ name: "race.qly", data: FC_QLY }]);
  const s = sessions[0];
  check("no ini: classCode is empty, not X", s?.classCode === "", `got "${s?.classCode}"`);
  check(
    "no ini: className is UNKNOWN, not SECURE",
    s?.className === "UNKNOWN",
    `got "${s?.className}"`,
  );

  const picked = parseAccuTimePack([{ name: "race.qly", data: FC_QLY }], { classCode: "FC" });
  check(
    "class pick fills the classless session",
    picked.sessions[0]?.className === "FUNNY CAR",
    `got "${picked.sessions[0]?.className}"`,
  );
}

// ——— 4. Two-class loose drop, paired by name stem ———
{
  const { sessions } = parseAccuTimePack([
    { name: "FC.qly", data: FC_QLY },
    { name: "FC-Class.ini", data: latin1(FC_INI) },
    { name: "TF.qly", data: TF_QLY },
    { name: "TF-Class.ini", data: latin1(TF_INI) },
  ]);
  const names = sessions.map((s) => s.className).sort();
  check(
    "stem-matched pile → FUNNY CAR + TOP FUEL",
    names.join("|") === "FUNNY CAR|TOP FUEL",
    names.join("|"),
  );
  check(
    "each session keeps its own series title",
    sessions.every((s) => s.seriesName === "NHRA Mission Foods Drag Racing Series"),
  );
}

// ——— 5. Two-class loose drop, paired by folder ———
{
  const { sessions } = parseAccuTimePack([
    { name: "fc/race.qly", data: FC_QLY },
    { name: "fc/Class.ini", data: latin1(FC_INI) },
    { name: "tf/race.qly", data: TF_QLY },
    { name: "tf/Class.ini", data: latin1(TF_INI) },
  ]);
  const names = sessions.map((s) => s.className).sort();
  check(
    "folder-grouped pile → FUNNY CAR + TOP FUEL",
    names.join("|") === "FUNNY CAR|TOP FUEL",
    names.join("|"),
  );
}

// ——— 6. Unmatched leftovers are reported, resolved sessions still export ———
{
  const { sessions, warnings } = parseAccuTimePack([
    { name: "FC.qly", data: FC_QLY },
    { name: "FC-Class.ini", data: latin1(FC_INI) },
    { name: "mystery.ini", data: latin1(TF_INI) },
    { name: "TD-Class.ini", data: latin1(FC_INI.replace("11=FC", "11=TD")) },
  ]);
  check("resolved session still parses", sessions.some((s) => s.className === "FUNNY CAR"));
  check(
    "leftover inis are reported, not silently dropped",
    warnings.some((w) => w.includes("mystery.ini") && w.includes("TD-Class.ini")),
    JSON.stringify(warnings),
  );
}

// ——— 7. Header logos: PDFs build with and without them ———
{
  const TINY_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const { sessions } = parseAccuTimePack([
    { name: "race.qly", data: FC_QLY },
    { name: "Class.ini", data: latin1(FC_INI) },
  ]);
  const plain = buildAccuTimeArtifacts(sessions, []);
  const withLogos = buildAccuTimeArtifacts(sessions, [], {
    logos: { left: TINY_PNG, center: TINY_PNG, right: TINY_PNG },
  });
  check("qualifying PDF builds without logos", (plain.qualifyingPdf?.length ?? 0) > 0);
  check("qualifying PDF builds with logos", (withLogos.qualifyingPdf?.length ?? 0) > 0);
  check(
    "logo PDF is larger (images embedded)",
    (withLogos.qualifyingPdf?.length ?? 0) > (plain.qualifyingPdf?.length ?? 0),
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll AccuTime fixture checks passed.");
