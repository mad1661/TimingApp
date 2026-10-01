/**
 * Regression fixture for the AccuTime parser — no test framework in this repo,
 * so this is a plain script: `npx tsx scripts/accutime-fixture-check.ts`.
 * Exits non-zero on the first failed check.
 *
 * Covers the v1.41.1 fixes: Class.ini [Menu] → FC resolves to FUNNY CAR, a
 * missing ini never falls back to the Secure "X" placeholder, the page's class
 * pick fills a classless session, the series title reads from [Reports], and a
 * two-class loose drop splits into two sessions (by name stem and by folder).
 * v1.43.0 adds the pro (Mission Foods) scoring checks: round/qual/participation
 * math on both event scales, Countdown vs Pomona 2, session bonuses present vs
 * skipped, and pro classes no longer landing in pointsSkipped.
 * v1.44.0 adds the class-pack accumulation checks: merging a new drop into the
 * saved sessions by class (add new / replace same, never wipe the rest), the
 * JSON round-trip through browser storage, and the class pick reaching stored
 * sessions on a rebuild.
 * v1.47.0 adds AccuTime's unlocked text export (…dat.txt / …qly.txt /
 * Driversdbf.txt, no Class.ini): a synthetic two-event zip with OS clutter,
 * classes from folder names, race dates from the stamp, the time-segment
 * qualifying/elimination split, PM = 5 / FSS = 16, one PDF pair per event, the
 * event pick and the race-mismatch guard — plus, when Mike's real zip is on
 * disk (MIKE_TEXT_ZIP), structure checks against the 2026 GL / Rockingham data.
 */
import * as fs from "fs";
import * as path from "path";
import { deflateSync, inflateSync } from "zlib";
import { zipSync } from "fflate";
import {
  accuEventGroups,
  accuPackConflict,
  applyAccuClassPick,
  mergeAccuTimeSessions,
  parseAccuTimePack,
  parseClassIni,
  sanitizeAccuSessions,
  type AccuTimeSession,
} from "../src/lib/accutime";
import { buildAccuTimeArtifacts } from "../src/lib/accutime-export";
import {
  buildRacedataPdf,
  buildQualifyingPdf,
  type PdfCategory,
  type PdfEvent,
  type QualPdfCategory,
} from "../src/lib/racedata-pdf";
import {
  buildPointsFileContent,
  compulinkClassNumber,
  countdownSeedPoints,
  scoreAccuTimeSession,
  type ProEventScale,
} from "../src/lib/accutime-points";

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

// Minimal valid 8x8 RGB PNG, one shade per logo slot, generated in-process
// (identical images get deduped into one XObject, so each slot is distinct).
function tinyPng(shade: number): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.concat(
    Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(24, shade)])),
  );
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return "data:image/png;base64," + png.toString("base64");
}

/**
 * Count image-draw invocations (`/I<n> Do`) per page, in page order. Unlike a
 * whole-file XObject count this proves the logos are STAMPED on each page —
 * the v1.43.2 gap was continuation pages sharing the file's XObjects but
 * never drawing them.
 */
function perPageImageDraws(pdf: Uint8Array | null): number[] {
  if (!pdf) return [];
  const raw = Buffer.from(pdf).toString("latin1");
  const objs = new Map<number, string>();
  const re = /(\d+) 0 obj([\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) objs.set(Number(m[1]), m[2]);
  const counts: number[] = [];
  for (const body of objs.values()) {
    if (!/\/Type\s*\/Page[^s]/.test(body)) continue;
    const cm = body.match(/\/Contents\s+(\d+) 0 R/);
    const cbody = cm ? objs.get(Number(cm[1])) || "" : "";
    const sm = cbody.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    let content = sm ? sm[1] : "";
    if (/FlateDecode/.test(cbody)) {
      try {
        content = inflateSync(Buffer.from(content, "latin1")).toString("latin1");
      } catch {
        content = "";
      }
    }
    counts.push((content.match(/\/I\d+ Do/g) || []).length);
  }
  return counts;
}

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

// ——— 7. Header logos: finals PDF yes, qualifying PDF NEVER (v1.43.4) ———
// The v1.43.1 bug was logos not reaching the finals PDF at all; v1.43.4 sets
// the product rule: the finals PDF carries the logos (page 1), while the
// qualifying sheet must stay logo-free even when a logo package is supplied.
// Assert the actual image XObjects, per PDF, with a distinct image per slot
// (identical images get deduped into one XObject).
{
  const countImages = (pdf: Uint8Array | null): number =>
    pdf ? (Buffer.from(pdf).toString("latin1").match(/\/Subtype\s*\/Image/g) || []).length : -1;

  // The finals PDF only builds when a session has elimination rounds, so a
  // minimal Compulink EDAT (path B) rides along with the qualifying session.
  const TS_EDAT = latin1(
    [
      "Compulink StarTrak TOP SPORTSMAN Elimination Results",
      "FINALS",
      "175W,935755,TS,1,Stan Wadoski,Union ME,'63 Nova,CHEV  765,  .018,, 7.456,176.72",
      "115,945840,TS,2,Rick Homan,Allentown PA,'08 Cobalt,CHEV  540,  .034,, 7.501,175.20",
      "End of File",
    ].join("\r\n"),
  );
  const { sessions } = parseAccuTimePack([
    { name: "race.qly", data: FC_QLY },
    { name: "Class.ini", data: latin1(FC_INI) },
    { name: "C11EDAT.TXT", data: TS_EDAT },
  ]);
  check(
    "logo fixture has an elim session (finals PDF) and a qualifying session",
    sessions.some((s) => s.elimRounds.length > 0) && sessions.some((s) => s.qualifying.length > 0),
    sessions.map((s) => `${s.className}: elim ${s.elimRounds.length}, qual ${s.qualifying.length}`).join(" | "),
  );
  const plain = buildAccuTimeArtifacts(sessions, []);
  const withLogos = buildAccuTimeArtifacts(sessions, [], {
    logos: { left: tinyPng(0x11), center: tinyPng(0x77), right: tinyPng(0xee) },
  });
  check("finals PDF builds without logos, image-free", countImages(plain.finalsPdf) === 0);
  check("qualifying PDF builds without logos, image-free", countImages(plain.qualifyingPdf) === 0);
  check(
    "finals PDF embeds all 3 header logos",
    countImages(withLogos.finalsPdf) === 3,
    `got ${countImages(withLogos.finalsPdf)} image XObjects`,
  );
  check(
    "qualifying PDF stays image-free even WITH a logo package",
    countImages(withLogos.qualifyingPdf) === 0,
    `got ${countImages(withLogos.qualifyingPdf)} image XObjects`,
  );
}

// ——— 7b. Logo placement per page (v1.43.4 product rule) ———
// Finals PDF: logos on the FIRST page of the document only — v1.43.3's
// every-page stamping is reverted, so page 2+ (summary continuations and all
// elimination pages) must draw zero images. Qualifying PDF: zero images on
// every page, logos or not. Force both PDFs past one page and assert the
// per-page draw invocations, not just the file-level XObjects.
{
  const event: PdfEvent = {
    series: "NHRA Mission Foods Drag Racing Series",
    dates: "September 18, 2026",
    roundDate: "18/SEP/2026",
    brand: "AccuTime",
    logos: { left: tinyPng(0x11), center: tinyPng(0x77), right: tinyPng(0xee) },
  };

  // Finals: a 60-row summary spills the summary section onto page 2+, and six
  // 10-pair rounds spill the elimination listing onto continuation pages.
  const roundRow = (n: number) => ({
    num: String(n), cls: "TF", qfy: "1", driver: `Driver ${n}`, home: "Town ST",
    car: "'08 Chevy", motor: "CHEV 500", reaction: "0.050", di: "", et: "7.500", mph: "180.00",
  });
  const finalsCats: PdfCategory[] = Array.from({ length: 2 }, (_, c) => ({
    name: `CLASS ${c + 1}`,
    hasDI: false,
    rows: Array.from({ length: 60 }, (_, i) => ({
      label: "Low E.T.", num: String(i), driver: `Driver ${i}`, hometown: "Town ST", car: "'08 Chevy", et: "7.500",
    })),
    rounds: Array.from({ length: 6 }, (_, r) => ({
      name: `ROUND ${r + 1}`,
      pairs: Array.from({ length: 10 }, (_, p) => ({ rows: [roundRow(p * 2), roundRow(p * 2 + 1)], single: false })),
    })),
  }));
  const finalsDraws = perPageImageDraws(buildRacedataPdf(event, finalsCats));
  check("multi-page finals PDF really is multi-page", finalsDraws.length > 2, `got ${finalsDraws.length} pages`);
  check(
    "finals PDF draws all 3 logos on page 1",
    finalsDraws[0] === 3,
    `page-1 draws: ${finalsDraws[0]}`,
  );
  check(
    "finals PDF draws NO logos on page 2+",
    finalsDraws.length > 1 && finalsDraws.slice(1).every((n) => n === 0),
    `per-page draws: [${finalsDraws.join(", ")}]`,
  );

  // Qualifying: 120 entries per class overflow each class onto extra pages.
  const qualCats: QualPdfCategory[] = Array.from({ length: 2 }, (_, c) => ({
    name: `QCLASS ${c + 1}`,
    entries: Array.from({ length: 120 }, (_, i) => ({
      pos: String(i + 1), num: String(i), cls: "TF", driver: `Driver ${i}`, hometown: "Town ST",
      car: "'08 Chevy", motor: "CHEV 500", et: "7.500", index: "", diff: "",
    })),
  }));
  const qualDraws = perPageImageDraws(buildQualifyingPdf(event, qualCats));
  check("multi-page qualifying PDF really is multi-page", qualDraws.length > 2, `got ${qualDraws.length} pages`);
  check(
    "qualifying PDF draws ZERO logos on every page, even with a logo package",
    qualDraws.length > 0 && qualDraws.every((n) => n === 0),
    `per-page draws: [${qualDraws.join(", ")}]`,
  );

  // No logos → no image draws anywhere, and the pages still build (the
  // text-only header keeps its original layout).
  const noLogoDraws = perPageImageDraws(buildRacedataPdf({ ...event, logos: undefined }, finalsCats));
  check(
    "finals PDF without logos stays image-free on every page",
    noLogoDraws.length > 2 && noLogoDraws.every((n) => n === 0),
    `per-page draws: [${noLogoDraws.join(", ")}]`,
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

// ——— 9. Pro (Mission Foods) scoring: rounds, qual ladder, participation,
// session bonuses, event scales, and pro no longer skipped ———
{
  type ElimRun = AccuTimeSession["runs"][number];
  const elimRun = (car: string, round: string, winner: boolean): ElimRun => ({
    timestamp: null,
    round,
    qual_pos: null,
    car_number: car,
    name: `Driver ${car}`,
    member_number: null,
    class_index: null,
    rt: null,
    ft60: null,
    ft330: null,
    ft660: null,
    mph_660: null,
    ft1000: null,
    mph_1000: null,
    ft1320: null,
    mph_1320: null,
    mov: null,
    is_winner: winner ? 1 : 0,
    is_dq: 0,
    result: winner ? "W" : "L",
    place: null,
    category: "TOP FUEL",
    lane: null,
    dial_in: null,
    event_code: null,
    event_name: null,
    event_type: null,
    season: null,
    start_date: null,
  });
  const pairOf = (w: string, l: string, round: string) => ({
    runs: [elimRun(w, round, true), elimRun(l, round, false)],
    single: false,
  });

  // 16-car ladder: car n = qualifying position n. E1 1v16..8v9 (low seed
  // wins), E2 1v8..4v5, semis 1v4 / 2v3, final 1v2.
  const elimRounds: AccuTimeSession["elimRounds"] = [
    { round: "E1", label: "ROUND 1", pairs: Array.from({ length: 8 }, (_, i) => pairOf(String(i + 1), String(16 - i), "E1")) },
    { round: "E2", label: "ROUND 2", pairs: Array.from({ length: 4 }, (_, i) => pairOf(String(i + 1), String(8 - i), "E2")) },
    { round: "E3", label: "ROUND 3", pairs: [pairOf("1", "4", "E3"), pairOf("2", "3", "E3")] },
    { round: "F", label: "FINALS", pairs: [pairOf("1", "2", "F")] },
  ];
  // 17 attempts: 16 qualified + one DNQ (position 17).
  const qualifying: AccuTimeSession["qualifying"] = Array.from({ length: 17 }, (_, i) => ({
    pos: i + 1,
    car_number: String(i + 1),
    name: `Driver ${i + 1}`,
    rt: null,
    et: 3.7 + i * 0.01,
    mph: null,
    bestSession: 1,
  }));
  // Q1 complete (all 16 ran): lows are cars 1-4 in order. Q2 only 5 of 16
  // cars ran → treated as incomplete, no bonus despite car 5's low ET.
  const q1 = {
    session: 1,
    passes: Array.from({ length: 16 }, (_, i) => ({
      car_number: String(i + 1),
      name: `Driver ${i + 1}`,
      et: i < 4 ? 3.7 + i * 0.01 : 3.9 + i * 0.01,
    })),
  };
  const q2 = {
    session: 2,
    passes: Array.from({ length: 5 }, (_, i) => ({
      car_number: String(i + 1),
      name: `Driver ${i + 1}`,
      et: 3.65 + i * 0.01,
    })),
  };

  const proSession = (over: Partial<AccuTimeSession> = {}): AccuTimeSession => ({
    classCode: "TF",
    className: "TOP FUEL",
    raceDate: "2026-09-01",
    seriesName: null,
    treeBase: 0.4,
    qualifying,
    qualSessions: 2,
    qualSessionPasses: [q1, q2],
    runs: elimRounds.flatMap((r) => r.pairs.flatMap((p) => p.runs)),
    elimRounds,
    lowEt: null,
    topSpeed: null,
    drivers: [],
    warnings: [],
    ...over,
  });
  const noCard = () => null;
  const score = (scale: ProEventScale, over: Partial<AccuTimeSession> = {}) =>
    scoreAccuTimeSession(proSession(over), noCard, { proScale: scale });
  const ptsOf = (rows: { car_number: string; points: number }[], car: string) =>
    rows.find((r) => r.car_number === car)?.points;

  // Regular scale: W 100 / RU 80 / R3 60 / R2 40 / R1 20, qual 8..1,
  // attempt 10, Q1 session lows 3/2/1 (cars 1-3), Q2 incomplete → nothing.
  const reg = score("regular");
  check("pro regular: winner 100+8+10+3 = 121", ptsOf(reg.rows, "1") === 121, `got ${ptsOf(reg.rows, "1")}`);
  check("pro regular: runner-up 80+7+10+2 = 99", ptsOf(reg.rows, "2") === 99, `got ${ptsOf(reg.rows, "2")}`);
  check("pro regular: R3 loser 60+6+10+1 = 77", ptsOf(reg.rows, "3") === 77, `got ${ptsOf(reg.rows, "3")}`);
  check("pro regular: R2 loser 40+4+10 = 54 (no Q2 bonus)", ptsOf(reg.rows, "5") === 54, `got ${ptsOf(reg.rows, "5")}`);
  check("pro regular: R1 loser 20+1+10 = 31", ptsOf(reg.rows, "16") === 31, `got ${ptsOf(reg.rows, "16")}`);
  check("pro regular: DNQ (#17) attempt-only 10", ptsOf(reg.rows, "17") === 10, `got ${ptsOf(reg.rows, "17")}`);
  check(
    "pro regular: Q2 flagged incomplete in the notes",
    reg.notes.some((n) => n.includes("Q2") && n.includes("incomplete")),
    JSON.stringify(reg.notes),
  );

  // Indy scale: W 150 / RU 120 / R3 90 / R2 60 / R1 30, qual +2, attempt 15,
  // session lows 4/3/2/1.
  const indy = score("indy");
  check("pro Indy: winner 150+10+15+4 = 179", ptsOf(indy.rows, "1") === 179, `got ${ptsOf(indy.rows, "1")}`);
  check("pro Indy: runner-up 120+9+15+3 = 147", ptsOf(indy.rows, "2") === 147, `got ${ptsOf(indy.rows, "2")}`);
  check("pro Indy: R3 loser 90+8+15+2 = 115", ptsOf(indy.rows, "3") === 115, `got ${ptsOf(indy.rows, "3")}`);
  check("pro Indy: 4th session low pays (90+7+15+1 = 113)", ptsOf(indy.rows, "4") === 113, `got ${ptsOf(indy.rows, "4")}`);
  check("pro Indy: R1 loser 30+3+15 = 48", ptsOf(indy.rows, "16") === 48, `got ${ptsOf(indy.rows, "16")}`);

  // Countdown = regular values; the Pomona 2 finale = Indy values.
  check("pro Countdown scores the regular values", ptsOf(score("countdown").rows, "1") === 121);
  check("pro Pomona 2 finale scores the Indy values", ptsOf(score("PC2").rows, "1") === 179);

  // No per-session data (Compulink QDAT-only shape): bonuses skipped, said so.
  const noSess = score("regular", { qualSessionPasses: [] });
  check("pro without session data: winner 100+8+10 = 118", ptsOf(noSess.rows, "1") === 118, `got ${ptsOf(noSess.rows, "1")}`);
  check(
    "pro without session data: note explains skipped bonuses",
    noSess.notes.some((n) => n.includes("Per-session low-ET bonuses not scored")),
    JSON.stringify(noSess.notes),
  );

  // Through the full artifacts build: pro is scored, not skipped, and the
  // A16DP file carries the TF class number and the golden layout.
  const artifacts = buildAccuTimeArtifacts([proSession()], [], { pointsRaceCode: "16", proScale: "regular" });
  check("pro not in pointsSkipped", artifacts.pointsSkipped.length === 0, JSON.stringify(artifacts.pointsSkipped));
  const proCat = artifacts.points[0];
  check("pro category scored + flagged", proCat?.pro === true && proCat?.proScale === "regular");
  check("pro points file named C1A16DP.TXT", proCat?.filename === "C1A16DP.TXT", proCat?.filename);
  const proFile = buildPointsFileContent(proCat.category, proCat.rows);
  check(
    "pro A16DP header + winner row",
    proFile.startsWith("Compulink StarTrak EVENT Points for TOP FUEL w/REG code 1") &&
      proFile.includes("\r\n1,,Driver 1,0,121,0"),
    proFile.split("\r\n").slice(0, 3).join(" | "),
  );

  // Countdown reset seeds (season-standings helper, never in an A16DP file).
  check(
    "countdown seeds: 2100 / 2080 / 2070 / 2000 / 1990",
    countdownSeedPoints(1) === 2100 &&
      countdownSeedPoints(2) === 2080 &&
      countdownSeedPoints(3) === 2070 &&
      countdownSeedPoints(10) === 2000 &&
      countdownSeedPoints(11) === 1990,
  );
}

// ——— 10. Class-pack accumulation (v1.44.0): the browser saves every parsed
// session and posts them back with each drop; the server merges by class so
// uploading Top Fuel never wipes the Funny Car already built. ———
{
  const parseOne = (qlyData: Uint8Array, ini: string) =>
    parseAccuTimePack([
      { name: "race.qly", data: qlyData },
      { name: "Class.ini", data: latin1(ini) },
    ]).sessions;

  // Drop 1: FC alone. Drop 2: TF merges in — FC stays.
  const fc = parseOne(FC_QLY, FC_INI);
  const m1 = mergeAccuTimeSessions(fc, parseOne(TF_QLY, TF_INI));
  check(
    "merge: dropping TF keeps FC in the pack",
    m1.sessions.map((s) => s.className).join("|") === "FUNNY CAR|TOP FUEL",
    m1.sessions.map((s) => s.className).join("|"),
  );
  check(
    "merge: TF reported as added, nothing replaced",
    m1.merge.added.join() === "TOP FUEL" && m1.merge.replaced.length === 0,
    JSON.stringify(m1.merge),
  );

  // Drop 3: FC again (now with one qualifier) — replaces ONLY the FC slot.
  const fc2 = parseOne(FC_QLY, FC_INI);
  fc2[0].qualifying = fc2[0].qualifying.slice(0, 1);
  const m2 = mergeAccuTimeSessions(m1.sessions, fc2);
  check(
    "merge: re-dropped FC replaces just FC, in place",
    m2.sessions.length === 2 &&
      m2.sessions[0].className === "FUNNY CAR" &&
      m2.sessions[0].qualifying.length === 1 &&
      m2.sessions[1].className === "TOP FUEL" &&
      m2.sessions[1].qualifying.length === 2,
    m2.sessions.map((s) => `${s.className}:${s.qualifying.length}`).join("|"),
  );
  check(
    "merge: FC reported as replaced, nothing added",
    m2.merge.replaced.join() === "FUNNY CAR" && m2.merge.added.length === 0,
    JSON.stringify(m2.merge),
  );

  // The pack round-trips through JSON — the shape the browser stores in
  // IndexedDB and posts back as prior_sessions.
  const roundTripped = sanitizeAccuSessions(JSON.parse(JSON.stringify(m2.sessions)));
  check(
    "stored pack round-trips through JSON intact",
    roundTripped.length === 2 &&
      roundTripped[0].className === "FUNNY CAR" &&
      roundTripped[0].qualifying.length === 1 &&
      roundTripped[1].classCode === "TF",
    roundTripped.map((s) => `${s.className}:${s.qualifying.length}`).join("|"),
  );
  check(
    "sanitize drops junk instead of crashing",
    sanitizeAccuSessions([{ nope: 1 }, "x", null, 42]).length === 0 &&
      sanitizeAccuSessions("garbage").length === 0,
  );

  // Class pick on STORED sessions (the rebuild path never re-parses): the
  // session identity AND its runs' category — the EDAT grouping key — move to
  // the picked class.
  const classless = sanitizeAccuSessions(
    JSON.parse(JSON.stringify(parseAccuTimePack([{ name: "race.qly", data: FC_QLY }]).sessions)),
  );
  classless[0].runs = [
    { category: "UNKNOWN", car_number: "28" } as unknown as AccuTimeSession["runs"][number],
  ];
  const picked = applyAccuClassPick(classless, "FC");
  check(
    "class pick fills a stored classless session",
    picked[0].classCode === "FC" && picked[0].className === "FUNNY CAR",
    `${picked[0].classCode}/${picked[0].className}`,
  );
  check(
    "class pick rewrites the stored runs' category",
    picked[0].runs[0].category === "FUNNY CAR",
    String(picked[0].runs[0].category),
  );
  check(
    "sessions that already have a code are untouched by the pick",
    applyAccuClassPick(m2.sessions, "SST").every((s) => s.classCode !== "SST"),
  );

  // The artifacts build from the FULL pack — both classes' QDAT present.
  const arts = buildAccuTimeArtifacts(m2.sessions, []);
  check(
    "artifacts build from the whole pack (both classes' QDAT)",
    arts.qdat.length === 2,
    arts.qdat.map((q) => `${q.filename}:${q.category}`).join("|"),
  );
}

const names = (files: { filename: string }[]) => files.map((f) => f.filename).sort().join(" ");

// Strings drawn on a jsPDF page, in order (uncompressed or Flate streams).
function pdfStrings(pdf: Uint8Array | null): string[] {
  if (!pdf) return [];
  const raw = Buffer.from(pdf).toString("latin1");
  const out: string[] = [];
  const streams = raw.matchAll(/<<([^>]*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g);
  for (const [, dict, body] of streams) {
    let content = body;
    if (/FlateDecode/.test(dict)) {
      try {
        content = inflateSync(Buffer.from(body, "latin1")).toString("latin1");
      } catch {
        continue;
      }
    }
    for (const m of content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(m[1].replace(/\\(.)/g, "$1"));
  }
  return out;
}

// ——— 11. AccuTime's unlocked text export (v1.47.0) ———
// CSV dumps of the Logging / Drivers tables plus the .qly, one folder per
// class, no Class.ini, often two race weekends in one zip with macOS clutter.
{
  const LOG_HEADER =
    '"GeneralID","RunNumber","RoundNumber","RaceType","TreeType","TreeMode","DeepStage","EndOfTrack","AutoStart","asMinimum","asStart","asTotal","WorstRedLight","NoBreakOut","IndexRacing","IndexClass","Index","WinnerFlag","Lane","CarNumber","LastName","DialIn","ReactionTime","ft60","ft330","mph18","et18","mph1000","et1000","mph14","et14","Margin","OffDial","TimeStamp"';
  // [car, name, raw RT, ET, MPH, won] per lane; times truncated to 2 decimals like the real export.
  type Lane = [string, string, string, string, string, boolean];
  let gid = 0;
  const pass = (round: number, run: number, ts: string, left: Lane, right?: Lane): string[] =>
    [left, right ?? (["BYE", "", "0.00", "0.00", "0.00", false] as Lane)].map(
      ([car, name, rt, et, mph, won], i) =>
        `${++gid},${run},${round},0,0,1,1,7,1,5,5,70,0,1,0,"","",${won ? 1 : 0},"${i ? "R" : "L"}","${car}","${name}",0.00,${rt},1.03,2.80,190.10,3.40,240.50,4.30,${mph},${et},0.00,0.00,${ts}`,
    );
  const logCsv = (rows: string[][]) => latin1([LOG_HEADER, ...rows.flat()].join("\r\n") + "\r\n");
  const L = (car: string, et: string, won: boolean): Lane => [car, `Driver ${car}`, "0.45", et, "270.00", won];

  // Top Alcohol Dragster, 8 cars. Q1 and E1 both on 9/18 under RoundNumber 1,
  // E2 stopped by curfew after one pair and finished on 9/19, final 9/21.
  const TAD_LOG = logCsv([
    pass(1, 32, "9/18/2026 11:04:26", L("8", "5.40", false), L("3", "5.25", true)),
    pass(1, 33, "9/18/2026 11:08:05", L("5", "5.30", true), L("4", "5.31", false)),
    pass(1, 34, "9/18/2026 11:11:14", L("6", "5.35", false), L("2", "5.22", true)),
    pass(1, 35, "9/18/2026 11:14:28", L("7", "5.50", false), L("1", "5.20", true)),
    pass(1, 139, "9/18/2026 18:43:20", L("8", "5.60", false), L("1", "5.21", true)),
    pass(1, 140, "9/18/2026 18:46:25", L("7", "5.45", false), L("2", "5.23", true)),
    pass(1, 141, "9/18/2026 18:49:30", L("6", "5.36", false), L("3", "5.26", true)),
    pass(1, 142, "9/18/2026 18:52:33", L("5", "5.33", false), L("4", "5.29", true)),
    pass(2, 163, "9/18/2026 20:39:51", L("1", "5.22", true), L("4", "5.30", false)),
    pass(2, 33, "9/19/2026 16:50:53", L("2", "5.24", true), L("3", "5.27", false)),
    pass(3, 50, "9/21/2026 14:19:55", L("1", "5.21", true), L("2", "5.25", false)),
  ]);
  const qlyFor = (cars: string[], ets: string[]) =>
    qly(cars.map((c, i) => [`Driver ${c}`, c, "0.4500", ets[i], "270.00"] as [string, string, string, string, string]));
  const TAD_QLY = qlyFor(["1", "2", "3", "4", "5", "6", "7", "8"], ["5.2026", "5.2241", "5.2513", "5.2983", "5.3040", "5.3511", "5.4520", "5.4011"]);

  const DRIVERS_HEADER =
    '"GeneralID","CarNumber","Membership","FirstName","LastName","City","State","MakeOfCar","ModelOfCar","EngineMake","CuIn","General","IndexClass","RaceEvent"';
  const drivers = (cls: string, cars: string[]) =>
    latin1(
      [
        DRIVERS_HEADER,
        ...cars.map(
          (c, i) =>
            // General holds free text with a line break — a plain line split would shear the row.
            `${i + 1},"${c}","${900000 + i}","First${c}","Driver ${c}","Town${c}","IN","24","Dragster","HEMI","433","Crew ${c}\r\nSponsor ${c}","${cls}","20260918084551"`,
        ),
      ].join("\r\n") + "\r\n",
    );

  // Pro Mod, 4 cars: qualifying 9/18, eliminations 9/20 — the classic date
  // split. Car 9 skips Q2, then runs the final as a single (12 broke).
  const PM_LOG = logCsv([
    pass(1, 10, "9/18/2026 13:00:00", L("9", "5.80", true), L("10", "5.85", false)),
    pass(1, 11, "9/18/2026 13:03:00", L("11", "5.90", false), L("12", "5.75", true)),
    pass(2, 20, "9/19/2026 13:00:00", L("10", "5.82", true), L("11", "5.88", false)),
    pass(2, 21, "9/19/2026 13:03:00", L("12", "5.74", true)),
    pass(1, 40, "9/20/2026 12:00:00", L("9", "5.79", true), L("10", "5.81", false)),
    pass(1, 41, "9/20/2026 12:03:00", L("12", "5.73", true), L("11", "5.95", false)),
    pass(2, 60, "9/20/2026 15:00:00", L("9", "5.78", true)),
  ]);
  const PM_QLY = qlyFor(["12", "9", "10", "11"], ["5.7391", "5.7922", "5.8123", "5.8840"]);

  // Funny Car at the second weekend (its own stamp).
  const FC_LOG = logCsv([
    pass(1, 5, "9/25/2026 14:00:00", L("1", "3.90", true), L("2", "3.95", false)),
    pass(1, 70, "9/27/2026 11:00:00", L("1", "3.89", true), L("2", "3.96", false)),
  ]);

  const zipped = zipSync({
    "Mike Text Files/2026-09-18 thru 09-21 - Event A/Top Alcohol Dragster/20260918084551dat.txt": TAD_LOG,
    "Mike Text Files/2026-09-18 thru 09-21 - Event A/Top Alcohol Dragster/20260918084551qly.txt": TAD_QLY,
    "Mike Text Files/2026-09-18 thru 09-21 - Event A/Top Alcohol Dragster/Driversdbf.txt": drivers("TAD", ["1", "2", "3", "4", "5", "6", "7", "8"]),
    "Mike Text Files/2026-09-18 thru 09-21 - Event A/Pro Mod/20260918084551dat.txt": PM_LOG,
    "Mike Text Files/2026-09-18 thru 09-21 - Event A/Pro Mod/20260918084551qly.txt": PM_QLY,
    "Mike Text Files/2026-09-18 thru 09-21 - Event A/Factory Stock Showdown/20260918084551qly.txt": qlyFor(["B346", "3397"], ["7.5586", "7.5877"]),
    "Mike Text Files/2026-09-25 thru 09-27 - Event B/Funny Car/20260925082555dat.txt": FC_LOG,
    "Mike Text Files/.DS_Store": latin1("\x00\x00\x00\x01Bud1"),
    "__MACOSX/Mike Text Files/2026-09-18 thru 09-21 - Event A/Top Alcohol Dragster/._20260918084551qly.txt": latin1("\x00\x05\x16\x07junk"),
  });

  const { sessions, warnings } = parseAccuTimePack([{ name: "Mike Text Files.zip", data: zipped }]);
  const byCode = new Map(sessions.map((s) => [s.classCode, s]));
  check(
    "text export: four classes from the zip, clutter ignored",
    sessions.length === 4 && ["TAD", "PM", "FSS", "FC"].every((c) => byCode.has(c)),
    sessions.map((s) => `${s.classCode}:${s.className}`).join("|") + " " + JSON.stringify(warnings),
  );
  check(
    "text export: no warning about __MACOSX / ._ / .DS_Store files",
    !warnings.some((w) => /__MACOSX|\._|DS_Store/.test(w)),
    JSON.stringify(warnings),
  );
  check(
    "text export: one note that classes came from folder names",
    warnings.filter((w) => w.startsWith("No Class.ini")).length === 1 &&
      warnings.some((w) => w.includes("Top Alcohol Dragster → TAD") && w.includes("Pro Mod → PM")),
    JSON.stringify(warnings),
  );

  const tad = byCode.get("TAD")!;
  check("text export: race date from the file stamp", tad?.raceDate === "2026-09-18", String(tad?.raceDate));
  check("text export: race stamp kept as raceId", tad?.raceId === "20260918084551", String(tad?.raceId));
  check("text export: className from the folder's code", tad?.className === "TOP ALCOHOL DRAGSTER", tad?.className);
  check(
    "text export: Drivers CSV with a line break inside a quoted field reads all 8 cards",
    tad?.drivers.length === 8 && tad.drivers[0].member_number === "900000" && tad.drivers[0].city === "Town1",
    JSON.stringify(tad?.drivers.slice(0, 1)),
  );
  check("text export: qualifying order from …qly.txt", tad?.qualifying.length === 8 && tad.qualifying[0].car_number === "1");

  // Same-day Q1 + E1, curfew-split E2.
  check(
    "split: Q1 and E1 on the same day under one RoundNumber come apart",
    tad?.qualSessions === 1 && tad.elimRounds[0]?.round === "E1" && tad.elimRounds[0].pairs.length === 4,
    `qual ${tad?.qualSessions}, rounds ${tad?.elimRounds.map((r) => `${r.round}(${r.pairs.length})`).join(" ")}`,
  );
  check(
    "split: E2 stopped by curfew and finished next day is one round of 2 pairs",
    tad?.elimRounds[1]?.round === "E2" && tad.elimRounds[1].pairs.length === 2,
    tad?.elimRounds.map((r) => `${r.round}(${r.pairs.length})`).join(" "),
  );
  check(
    "split: the final is the last round",
    tad?.elimRounds.length === 3 && tad.elimRounds[2].round === "F" && tad.elimRounds[2].pairs[0].runs[0].car_number === "1",
  );
  check(
    "split: E1 pairs follow the ladder (seeds sum to 9)",
    tad?.elimRounds[0].pairs.every((p) => p.runs.reduce((n, r) => n + (r.qual_pos || 0), 0) === 9),
    JSON.stringify(tad?.elimRounds[0].pairs.map((p) => p.runs.map((r) => r.qual_pos))),
  );
  check(
    "Low ET from qualifying passes, at the .qly's full precision (5.20 → 5.2026)",
    tad?.lowEt?.car === "1" && tad.lowEt.et === 5.2026,
    JSON.stringify(tad?.lowEt),
  );

  const pm = byCode.get("PM")!;
  check(
    "split: date-split pro class — Q1/Q2 qualifying, E1 + final",
    pm?.qualSessions === 2 && pm.elimRounds.map((r) => `${r.round}(${r.pairs.length})`).join(" ") === "E1(2) F(1)",
    `qual ${pm?.qualSessions}, rounds ${pm?.elimRounds.map((r) => `${r.round}(${r.pairs.length})`).join(" ")}`,
  );
  check(
    "split: a final run as a single by a car that skipped Q2 stays the final",
    pm?.elimRounds[1]?.pairs.length === 1 && pm.elimRounds[1].pairs[0].single && pm.elimRounds[1].pairs[0].runs[0].car_number === "9",
  );
  check("qualifying-only class (no Logging) exports no rounds", byCode.get("FSS")?.elimRounds.length === 0);

  // Two weekends in one zip → two events; a pick narrows the drop to one.
  const events = accuEventGroups(sessions);
  check(
    "events: two race stamps → two events, labelled by folder",
    events.length === 2 &&
      events[0].key === "race:20260918084551" &&
      events[0].label === "2026-09-18 thru 09-21 - Event A" &&
      events[1].label === "2026-09-25 thru 09-27 - Event B",
    JSON.stringify(events.map(({ key, label, classes }) => ({ key, label, classes }))),
  );
  const eventA = events[0].sessions;
  check("events: event A holds TAD, PM and FSS", eventA.map((s) => s.classCode).sort().join() === "FSS,PM,TAD");
  check("events: one event in a drop asks nothing", accuEventGroups(eventA).length === 1);
  check(
    "events: a different race than the pack is flagged",
    accuPackConflict(eventA, events[1].sessions)?.drop.label === "2026-09-25 thru 09-27 - Event B",
  );
  check("events: the same race merges quietly", accuPackConflict(eventA, [tad]) === null);
  check(
    "events: no race stamps → nothing to compare",
    accuPackConflict(parseAccuTimePack([{ name: "race.qly", data: FC_QLY }]).sessions, eventA) === null,
  );
  check(
    "events: raceId survives the browser round-trip",
    sanitizeAccuSessions(JSON.parse(JSON.stringify(eventA)))[0].raceId === eventA[0].raceId,
  );

  // The event package: national numbers, one qualifying PDF + one finals PDF.
  const arts = buildAccuTimeArtifacts(eventA, [], {
    pointsRaceCode: "15",
    seriesHeader: "NHRA Mission Foods Drag Racing Series",
  });
  check("package: QDAT C5 / C6 / C16 (Pro Mod 5, Factory Stock Showdown 16)", names(arts.qdat) === "C16QDAT.TXT C5QDAT.TXT C6QDAT.TXT", names(arts.qdat));
  check("package: EDAT for the two classes with rounds", names(arts.edat) === "C5EDAT.TXT C6EDAT.TXT", names(arts.edat));
  check("package: points named C#A15DP", arts.points.map((p) => p.filename).sort().join(" ") === "C5A15DP.TXT C6A15DP.TXT");
  // The PM final was a single: no runner-up pass on file, so none is named.
  check(
    "package: IDX14 lists every class with the champion once the final ran",
    /^5,PM,0,0,0,Driver 9,,$/m.test(arts.idx?.content || "") &&
      /^6,TAD,0,0,900000,First1 Driver 1,First2 Driver 2,$/m.test(arts.idx?.content || "") &&
      /^16,FSS,0,0,0,,,$/m.test(arts.idx?.content || ""),
    arts.idx?.content,
  );
  check(
    "package: the TAD EDAT has three rounds — 4 + 2 pairs and the final",
    (arts.edat.find((f) => f.filename === "C6EDAT.TXT")?.content.match(/^(ROUND \d|FINALS)$/gm) || []).join() === "ROUND 1,ROUND 2,FINALS" &&
      arts.edat.find((f) => f.filename === "C6EDAT.TXT")?.pairs === 7,
  );
  check("package: QDAT Low ET line at full precision", /^Low ET 5\.203 1 /m.test(arts.qdat.find((f) => f.filename === "C6QDAT.TXT")?.content || ""));

  const qualText = pdfStrings(arts.qualifyingPdf);
  const finalsText = pdfStrings(arts.finalsPdf);
  check(
    "package: ONE qualifying PDF with every class, in class order",
    qualText.filter((s) => s === "TOP ALCOHOL DRAGSTER" || s === "PRO MOD" || s === "FACTORY STOCK SHOWDOWN").join("|") ===
      "TOP ALCOHOL DRAGSTER|PRO MOD|FACTORY STOCK SHOWDOWN",
    qualText.filter((s) => /^[A-Z ]{6,}$/.test(s)).join("|"),
  );
  check(
    "package: ONE finals PDF — summary for both classes, then each class's rounds",
    finalsText.filter((s) => s.includes("FINAL ROUND RESULTS")).length === 1 &&
      finalsText.filter((s) => s === "Elimination Results").length === 2 &&
      finalsText.includes("NHRA Mission Foods Drag Racing Series"),
    finalsText.slice(0, 12).join("|"),
  );

  // Nested zips open too; a locked archive says what to drop instead.
  const nested = parseAccuTimePack([{ name: "outer.zip", data: zipSync({ "inner/Mike Text Files.zip": zipped }) }]);
  check("archives: a zip inside a zip is opened", nested.sessions.length === 4, String(nested.sessions.length));
  const locked = new Uint8Array(zipSync({ "race.dat": latin1("x") }));
  locked[6] |= 1; // general-purpose flag bit 0: encrypted
  const lockedParse = parseAccuTimePack([{ name: "race.acc", data: locked }]);
  check(
    "archives: a password-locked .acc points at the unlocked text export",
    lockedParse.sessions.length === 0 && lockedParse.warnings.some((w) => /password-locked/.test(w) && /unlocked text export/.test(w)),
    JSON.stringify(lockedParse.warnings),
  );

  // Folder names → class codes, including the short forms.
  const folderCode = (folder: string) =>
    parseAccuTimePack([{ name: `${folder}/20260925082555qly.txt`, data: qlyFor(["1"], ["8.9000"]) }]).sessions[0]?.classCode;
  check(
    "folders: Stock / Super Stock / Comp Eliminator / Nostalgia Pro Stock / Top Dragster",
    folderCode("Stock") === "STK" &&
      folderCode("Super Stock") === "SS" &&
      folderCode("Comp Eliminator") === "COMP" &&
      folderCode("Nostalgia Pro Stock") === "NPS" &&
      folderCode("Top Dragster") === "TD",
  );
  check("folders: a bare code or a bracketed one", folderCode("TAFC") === "TAFC" && folderCode("Funny Car (FC)") === "FC");
  const unnamed = parseAccuTimePack([{ name: "Misc/20260925082555qly.txt", data: qlyFor(["1"], ["8.9000"]) }]);
  check(
    "folders: a folder that names no class is reported, not guessed",
    unnamed.sessions[0]?.classCode === "" && unnamed.sessions[0].warnings.some((w) => w.includes('"Misc"')),
    JSON.stringify(unnamed.sessions[0]?.warnings),
  );

  check(
    "class numbers: PM 5, FSS 16, Stock Eliminator 13; Nostalgia Pro Stock has none",
    compulinkClassNumber("PRO MOD", "PM") === 5 &&
      compulinkClassNumber("FACTORY STOCK SHOWDOWN", "") === 16 &&
      compulinkClassNumber("STOCK ELIMINATOR", "") === 13 &&
      compulinkClassNumber("STOCK", "") === 13 &&
      compulinkClassNumber("NOSTALGIA PRO STOCK", "NPS") === null,
  );
}

// ——— 12. Mike's real text-export zip (optional) ———
// The 2026-09-18 → 09-27 email: US 131 (GL) and Rockingham in one zip.
// Runs when MIKE_TEXT_ZIP points at it (or it sits at /tmp/mike-text.zip).
{
  const zipPath = process.env.MIKE_TEXT_ZIP || "/tmp/mike-text.zip";
  if (fs.existsSync(zipPath)) {
    const { sessions, warnings } = parseAccuTimePack([
      { name: path.basename(zipPath), data: new Uint8Array(fs.readFileSync(zipPath)) },
    ]);
    const events = accuEventGroups(sessions);
    check("mike: 20 classes across 2 events", sessions.length === 20 && events.length === 2, `${sessions.length} / ${events.length}`);
    const [gl, rk] = events;
    check("mike: US 131 first, then Rockingham", /US 131/.test(gl?.label || "") && /Rockingham/.test(rk?.label || ""), `${gl?.label} | ${rk?.label}`);

    const rounds = (s: AccuTimeSession | undefined) => s?.elimRounds.map((r) => `${r.round}(${r.pairs.length})`).join(" ");
    const glBy = new Map(gl.sessions.map((s) => [s.classCode, s]));
    check(
      "mike GL: TAD is a real ladder (Q1 and E1 shared 9/18; E2 split across days)",
      rounds(glBy.get("TAD")) === "E1(8) E2(4) E3(2) F(1)",
      rounds(glBy.get("TAD")),
    );
    check("mike GL: TAFC through round 3, no final in the dump", rounds(glBy.get("TAFC")) === "E1(5) E2(3) E3(2)", rounds(glBy.get("TAFC")));
    check("mike GL: TS round 3 keeps its 9/18 pairs", rounds(glBy.get("TS")) === "E1(12) E2(6) E3(3) E4(2) F(1)", rounds(glBy.get("TS")));
    check("mike GL: FSS E1/E2 from Friday night", rounds(glBy.get("FSS")) === "E1(8) E2(4)", rounds(glBy.get("FSS")));
    check("mike GL: FC unchanged", rounds(glBy.get("FC")) === "E1(8) E2(4) E3(2) F(1)" && glBy.get("FC")?.qualSessions === 4);

    const glArts = buildAccuTimeArtifacts(gl.sessions, [], { pointsRaceCode: "15" });
    check(
      "mike GL: C1-C4, C6, C7, C14, C16 QDAT",
      names(glArts.qdat) === "C14QDAT.TXT C16QDAT.TXT C1QDAT.TXT C2QDAT.TXT C3QDAT.TXT C4QDAT.TXT C6QDAT.TXT C7QDAT.TXT",
      names(glArts.qdat),
    );
    const champs = (glArts.idx?.content || "").split("\r\n").filter((l) => /^\d/.test(l)).map((l) => l.split(",").slice(0, 2).concat(l.split(",")[5]).join(":"));
    check(
      "mike GL: IDX champions",
      champs.join("|") ===
        "1:TF:Shawn Langdon|2:FC:Jordan Vandergriff|3:PS:Troy Coughlin Jr|4:PSM:John Hall|6:TAD:Greg Hunter|7:TAFC:|14:TS:Curtis Fredrich|16:FSS:",
      champs.join("|"),
    );
    check("mike GL: one qualifying + one finals PDF", !!glArts.qualifyingPdf && !!glArts.finalsPdf);

    const rkArts = buildAccuTimeArtifacts(rk.sessions, [], { pointsRaceCode: "16" });
    check(
      "mike RK: Pro Mod on C5, the sportsman classes on their national numbers",
      names(rkArts.edat) === "C11EDAT.TXT C12EDAT.TXT C13EDAT.TXT C15EDAT.TXT C1EDAT.TXT C2EDAT.TXT C3EDAT.TXT C4EDAT.TXT C5EDAT.TXT C8EDAT.TXT C9EDAT.TXT",
      names(rkArts.edat),
    );
    check(
      "mike RK: Nostalgia Pro Stock's placeholder passes make no rounds",
      rk.sessions.find((s) => s.classCode === "NPS")?.elimRounds.length === 0,
    );
    check("mike: no unexpected top-level warnings", warnings.length === 1 && warnings[0].startsWith("No Class.ini"), JSON.stringify(warnings));
  } else {
    console.log("  --  Mike's text-export zip not found (MIKE_TEXT_ZIP) — real-data checks skipped");
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll AccuTime fixture checks passed.");
