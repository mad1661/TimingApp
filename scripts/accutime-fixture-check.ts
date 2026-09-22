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
import * as fs from "fs";
import * as path from "path";
import { parseAccuTimePack, parseClassIni } from "../src/lib/accutime";
import { buildAccuTimeArtifacts } from "../src/lib/accutime-export";
import { buildPointsFileContent } from "../src/lib/accutime-points";

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

// ——— 8. Path B: Compulink QDAT + EDAT ingest against the golden sample ———
// Optional: runs when a golden RACEDATA extract is present (GOLDEN_DIR env or
// /tmp/golden). The Super Street pair (C10) exercises pairing, class numbers,
// A16DP naming and the scoring itself.
{
  const dir = process.env.GOLDEN_DIR || "/tmp/golden";
  const qdatPath = path.join(dir, "C10QDAT.TXT");
  const edatPath = path.join(dir, "C10EDAT.TXT");
  if (fs.existsSync(qdatPath) && fs.existsSync(edatPath)) {
    const { sessions, warnings } = parseAccuTimePack([
      { name: "C10QDAT.TXT", data: new Uint8Array(fs.readFileSync(qdatPath)) },
      { name: "C10EDAT.TXT", data: new Uint8Array(fs.readFileSync(edatPath)) },
    ]);
    check("golden: one session from the C10 pair", sessions.length === 1, `got ${sessions.length}; ${JSON.stringify(warnings)}`);
    const s = sessions[0];
    check("golden: className SUPER STREET", s?.className === "SUPER STREET", `got "${s?.className}"`);
    check("golden: classCode SST", s?.classCode === "SST", `got "${s?.classCode}"`);
    check("golden: six elimination rounds", s?.elimRounds.length === 6, `got ${s?.elimRounds.length}`);
    check("golden: final round present", s?.elimRounds[s.elimRounds.length - 1]?.round === "F");
    check("golden: 20 qualifiers from QDAT", s?.qualifying.length === 20, `got ${s?.qualifying.length}`);

    const artifacts = buildAccuTimeArtifacts(sessions, [], { pointsRaceCode: "16" });
    check("golden: EDAT renamed C10EDAT.TXT", artifacts.edat[0]?.filename === "C10EDAT.TXT", artifacts.edat[0]?.filename);
    check("golden: QDAT named C10QDAT.TXT", artifacts.qdat[0]?.filename === "C10QDAT.TXT", artifacts.qdat[0]?.filename);
    const pts = artifacts.points[0];
    check("golden: points file named C10A16DP.TXT", pts?.filename === "C10A16DP.TXT", pts?.filename);
    check("golden: field of 39", pts?.fieldSize === 39, `got ${pts?.fieldSize}`);

    // Full-ladder scoring on the 33-64 bracket: one 105-point winner, one
    // 84-point runner-up, 19 round-1 losers at 30 and 10 round-2 losers at 40.
    const byPoints = (n: number) => pts?.rows.filter((r) => r.points === n).length ?? 0;
    check("golden: one winner at 105", byPoints(105) === 1 && pts?.rows[0].isWinner === true, `winners: ${byPoints(105)}`);
    check("golden: runner-up at 84", byPoints(84) === 1, `got ${byPoints(84)}`);
    check("golden: 19 round-1 losers at 30", byPoints(30) === 19, `got ${byPoints(30)}`);
    check("golden: 10 round-2 losers at 40", byPoints(40) === 10, `got ${byPoints(40)}`);

    // Identity enrichment straight from the Compulink rows (no external cards).
    const devita = pts?.rows.find((r) => r.car_number === "17");
    check(
      "golden: member # and name carried through",
      devita?.member_number === "979400" && devita?.name === "Peter Devita",
      JSON.stringify(devita),
    );

    // A16DP layout: header, 6 fields with the deduction slot, End of File + ^Z.
    const content = buildPointsFileContent(
      pts.category,
      pts.rows.map((r) => ({ ...r, deduction: r.car_number === "17" ? 10 : 0 })),
    );
    const lines = content.split("\r\n");
    check("golden: A16DP header line", lines[0] === "Compulink StarTrak EVENT Points for SUPER STREET w/REG code 1", lines[0]);
    check("golden: deduction rides field 6", lines.some((l: string) => /^17,979400,Peter Devita,\d+,\d+,10$/.test(l)));
    check("golden: End of File + Ctrl-Z", content.endsWith("End of File\r\n\x1a"));

    // IDX table row for the class, with the event champ.
    check("golden: IDX row 10,SST with champion", /^10,SST,0,0,\d+,.+,.+,$/m.test(artifacts.idx?.content || ""), artifacts.idx?.content.split("\r\n")[0]);
  } else {
    console.log("  --  golden RACEDATA extract not found — path B golden checks skipped");
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll AccuTime fixture checks passed.");
