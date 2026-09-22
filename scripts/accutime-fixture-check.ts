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
 */
import * as fs from "fs";
import * as path from "path";
import { deflateSync, inflateSync } from "zlib";
import {
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

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll AccuTime fixture checks passed.");
