/**
 * Regression checks for the Data Out export (getresults runs → the tower's
 * RACEDATA files) — no test framework in this repo, so this is a plain script:
 * `npx tsx scripts/dataout-fixture-check.ts`. Exits non-zero if any check fails.
 *
 * Every fixture is synthetic (made-up car numbers and drivers); the shapes are
 * the ones the 2026 tower packs and their getresults rows showed: a Compulink
 * bye stored with a blank-car row beside it, a Portatree bye with a literal
 * BYE car, Super Comp's sheet built from its round-1 winners, Stock's class
 * eliminations, a pass stored twice under two clock times, getresults'
 * 99.999 no-time stand-ins, an eighth-mile class with stray 1320 readings,
 * another event's week filed under a divisional, and so on.
 */
import type { RunRow } from "../src/lib/db";
import {
  buildDataOutExport,
  detectTimingSystem,
  elimRoundsForCategory,
  fmtRt,
  racedataFileText,
  truncFixed,
} from "../src/lib/edata-export";
import { buildDataOutArtifacts } from "../src/lib/dataout-export";
import { selectDataOutRuns } from "../src/lib/dataout-runs";
import { assignCompulinkClassNumbers, buildPointsFileContent } from "../src/lib/accutime-points";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

let seq = 0;
function run(p: Partial<RunRow>): RunRow {
  return {
    timestamp: null,
    round: "E1",
    qual_pos: 0,
    car_number: null,
    name: null,
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
    is_winner: 0,
    is_dq: 0,
    result: null,
    place: null,
    category: "COMPETITION ELIMINATOR",
    lane: "L",
    dial_in: null,
    event_code: "91",
    event_name: "Division 9 Race 1 06/18/2026",
    event_type: "D9",
    season: "2026",
    start_date: "20260618",
    _scrape_seq: seq++,
    ...p,
  };
}

/** A finished pass; `win` sets both winner flags. */
function pass(
  round: string,
  ts: string,
  car: string,
  et: number | null,
  extra: Partial<RunRow> = {},
  win = false,
): RunRow {
  return run({
    round,
    timestamp: ts,
    car_number: car,
    name: `Driver ${car}`,
    ft1320: et,
    mph_1320: et ? Math.round((1400 / et) * 100) / 100 : null,
    rt: 0.05,
    is_winner: win ? 1 : 0,
    result: win ? "W" : null,
    ...extra,
  });
}

function lines(content: string): string[] {
  return content.split("\r\n");
}

const T = (h: string) => `06/19/2026 ${h}`;

// ——— 1. Compulink byes, class column, RT format, finals ———
{
  const cat = "COMPETITION ELIMINATOR";
  const rows: RunRow[] = [
    pass("E1", T("12:30:08 PM"), "101", 7.015, { class_index: "C/DA", dial_in: 7.55, rt: -0.021, lane: "L" }, true),
    pass("E1", T("12:30:08 PM"), "102", 8.242, { class_index: "F/A", dial_in: 8.63, rt: 0.045, lane: "R" }),
    pass("E1", T("12:33:48 PM"), "103", 7.263, { class_index: "C/AA", dial_in: 7.85, lane: "R" }, true),
    pass("E1", T("12:33:48 PM"), "104", 9.02, { class_index: "I/SM", dial_in: 9.54, lane: "L" }),
    // Round 2: 101 v 103, and 105's bye — getresults stores the empty lane as a
    // blank car carrying junk from the entry screen.
    pass("E1", T("12:35:39 PM"), "105", 8.122, { class_index: "F/D", dial_in: 8.59, lane: "R" }, true),
    pass("E1", T("12:35:39 PM"), "106", 9.4, { class_index: "H/SM", dial_in: 9.52, lane: "L" }),
    pass("E2", T("02:09:07 PM"), "101", 7.341, { class_index: "C/DA", dial_in: 7.52, rt: 2.35 }, true),
    pass("E2", T("02:09:07 PM"), "103", 11.679, { class_index: "C/AA", dial_in: 7.77, lane: "R" }),
    pass("E2", T("02:15:17 PM"), "105", 8.664, { class_index: "F/D", dial_in: null, lane: "L" }, true),
    run({ round: "E2", timestamp: T("02:15:17 PM"), car_number: null, name: "ialist For Junk,,'67 Camaro,CHE", lane: "R" }),
    pass("E3", T("04:46:48 PM"), "105", 8.898, { class_index: "F/D", dial_in: 8.59, lane: "R" }, true),
    pass("E3", T("04:46:48 PM"), "101", 6.959, { class_index: "C/DA", dial_in: 7.51, lane: "L" }),
  ];
  const text = buildDataOutExport(rows, [], { timing: "compulink" });
  const edat = text.edat.find((f) => f.category === cat)!;
  const l = lines(edat.content);
  check("Compulink: EDAT named C11 (Comp)", edat.filename === "C11EDAT.TXT", edat.filename);
  check("Compulink: header", l[0] === "Compulink StarTrak COMPETITION ELIMINATOR Elimination Results", l[0]);
  check("bye: the lone racer is followed by a SINGLE marker", l.includes("SINGLE,0,,0,,,,,,,,"), edat.content);
  check("bye: the blank-car row is never written", !edat.content.includes("ialist") && !l.some((x) => x.startsWith(",")));
  check("class column prints the car's class, not the class code", l[2].split(",")[2] === "C/DA", l[2]);
  check("RT: the sign sits against the digits", l[2].split(",")[8] === " -.021", JSON.stringify(l[2].split(",")[8]));
  check("RT: an RT over a second keeps its leading digit", edat.content.includes(", 2.350,"), edat.content);
  check("final: one pairing after a round with a pair and a bye is the FINALS", l.includes("FINALS") && !l.includes("ROUND 3"), l.join(" | "));
  check("fmtRt formats", fmtRt(0.031) === "  .031" && fmtRt(-0.028) === " -.028" && fmtRt(1.293) === " 1.293" && fmtRt(0) === "  .000");
}

// ——— 2. Final detection edge cases ———
{
  const cat = "TOP SPORTSMAN";
  const base = (round: string, h: string, car: string, win: boolean) =>
    pass(round, T(h), car, 6.5, { category: cat, class_index: "TS" }, win);
  // A lone non-winner row (stored test junk) beside the semifinal pairs.
  const rounds = elimRoundsForCategory(
    [
      base("E1", "10:00:00 AM", "201", true),
      base("E1", "10:00:00 AM", "202", false),
      base("E1", "10:02:00 AM", "203", true),
      base("E1", "10:02:00 AM", "204", false),
      run({ round: "E1", timestamp: T("10:04:00 AM"), car_number: "m-JUNK", category: cat, ft1320: 6.9 }),
      base("E2", "02:00:00 PM", "201", true),
      base("E2", "02:00:00 PM", "203", false),
    ],
    cat,
  );
  check("final: a lone non-winner row in the semi doesn't stop the final", rounds[rounds.length - 1].isFinal);
  const still = elimRoundsForCategory(
    [
      base("E1", "10:00:00 AM", "201", true),
      base("E1", "10:00:00 AM", "202", false),
      base("E1", "10:02:00 AM", "203", true),
      base("E1", "10:02:00 AM", "204", false),
      base("E1", "10:04:00 AM", "205", true),
      base("E1", "10:04:00 AM", "206", false),
      base("E2", "02:00:00 PM", "201", true),
      base("E2", "02:00:00 PM", "203", false),
    ],
    cat,
  );
  check("final: a lone pairing the earlier winners don't fill is still a numbered round", !still[still.length - 1].isFinal);
  const twoCar = elimRoundsForCategory([base("E1", "10:00:00 AM", "201", true), base("E1", "10:00:00 AM", "202", false)], cat);
  check("final: a two-car class races only the final", twoCar[0].isFinal && twoCar[0].label === "FINALS");
}

// ——— 3. A pass stored twice, an empty duplicate row ———
{
  const cat = "SUPER COMP";
  const sc = (h: string, car: string, et: number | null, win: boolean, extra: Partial<RunRow> = {}) =>
    pass("E3", T(h), car, et, { category: cat, class_index: "SC", dial_in: 8.9, ...extra }, win);
  const rounds = elimRoundsForCategory(
    [
      sc("12:40:05 PM", "301", 9.061, true, { rt: 0.021 }),
      sc("12:40:05 PM", "302", 9.558, false, { rt: 0.038 }),
      sc("05:08:41 PM", "303", 8.91, true, { rt: 0.025 }),
      sc("05:08:41 PM", "304", 8.957, false, { rt: 0.003 }),
      // The same two passes again under the second pair's clock time.
      sc("05:08:41 PM", "301", 9.061, true, { rt: 0.021 }),
      sc("05:08:41 PM", "302", 9.558, false, { rt: 0.038 }),
      // An empty copy of a car one second before the next pair.
      sc("05:10:19 PM", "302", null, false, { rt: null, mph_1320: null }),
      sc("05:10:20 PM", "305", 8.95, true),
      sc("05:10:20 PM", "306", 8.97, false),
    ],
    cat,
  );
  const cars = rounds[0].pairs.map((p) => p.runs.map((r) => r.car_number).join("/"));
  check("duplicates: two pairs, not a 4-car pairing, and no stray empty copy", JSON.stringify(cars) === JSON.stringify(["301/302", "303/304", "305/306"]), JSON.stringify(cars));
}

// ——— 4. Super class qualifying sheet + EDAT qualifying positions ———
{
  const cat = "SUPER COMP";
  const sc = (round: string, h: string, car: string, et: number, win: boolean, extra: Partial<RunRow> = {}) =>
    pass(round, T(h), car, et, { category: cat, class_index: "SC", dial_in: 8.9, ...extra }, win);
  const rows: RunRow[] = [
    // Time trials (getresults codes them T) never make the sheet.
    pass("T1", "06/18/2026 10:00:00 AM", "401", 8.9, { category: cat, class_index: "SC", dial_in: 8.9 }),
    sc("E1", "02:57:27 PM", "401", 8.911, true, { rt: 0.012 }),
    sc("E1", "02:57:27 PM", "402", 8.898, false),
    sc("E1", "03:10:00 PM", "403", 8.9, true),
    sc("E1", "03:10:00 PM", "404", 8.95, false),
    sc("E1", "03:12:00 PM", "405", 8.911, true, { rt: 0.011 }),
    sc("E1", "03:12:00 PM", "406", 9.2, false),
    // A winner who broke out (the opponent red-lit) ranks after every clean pass.
    sc("E1", "03:14:00 PM", "407", 8.889, true),
    sc("E1", "03:14:00 PM", "408", 8.86, false, { rt: -0.01 }),
  ];
  const text = buildDataOutExport(rows, [], { timing: "compulink" });
  const q = text.qdat.find((f) => f.category === cat)!;
  check("super: the sheet is the round-1 winners", q?.entries === 4, `${q?.entries}`);
  check(
    "super: closest over the index, ties in run order, breakouts last",
    q?.qualifiers.map((e) => e.car).join(" ") === "403 401 405 407",
    q?.qualifiers.map((e) => e.car).join(" "),
  );
  const ql = lines(q.content);
  check("super: no Low ET line, ET right-aligned to six", ql[1].startsWith("Top Speed") && ql[2].endsWith(", 8.900,8.90,0.000"), ql.slice(0, 3).join(" | "));
  const e = text.edat.find((f) => f.category === cat)!;
  const el = lines(e.content);
  check("super: round-1 winners print their sheet position", el.some((x) => x.startsWith("403,0,SC,1,")), e.content);
  check("super: round-1 losers print 0", el.some((x) => x.startsWith("402,0,SC,0,")));
}

// ——— 5. Stock: QC and C1 count, C2 doesn't; dial-less passes; designation index ———
{
  const cat = "STOCK ELIMINATOR";
  const st = (round: string, h: string, car: string, et: number, extra: Partial<RunRow> = {}) =>
    pass(round, `06/18/2026 ${h}`, car, et, { category: cat, ...extra });
  const rows: RunRow[] = [
    st("Q1", "09:00:00 AM", "501", 10.5, { class_index: "B/SA", dial_in: 11.25 }),
    st("QC", "10:00:00 AM", "501", 10.3, { class_index: "B/SA", dial_in: 11.25 }),
    st("Q1", "09:01:00 AM", "502", 9.9, { class_index: "AA/S", dial_in: 10.7 }),
    st("C1", "11:00:00 AM", "502", 9.85, { class_index: "AA/S", dial_in: 10.7 }),
    st("C2", "01:00:00 PM", "502", 9.6, { class_index: "AA/S", dial_in: 10.7 }),
    // getresults shows no dial-in on 503's only pass: its designation's index applies.
    st("Q1", "09:02:00 AM", "503", 10.4, { class_index: "B/SA", dial_in: null }),
    st("Q1", "09:03:00 AM", "504", 12.0, { class_index: "G/SA", dial_in: 12.5 }),
    // A car number nobody names or classes isn't on the tower's sheet.
    st("Q1", "09:04:00 AM", "599", 9.0, { name: null, class_index: null, dial_in: null }),
  ];
  const q = buildDataOutExport(rows, [], {}).qdat.find((f) => f.category === cat)!;
  const order = q.qualifiers.map((e) => `${e.car}:${e.et}:${e.index}`);
  check(
    "stock: furthest under, QC and C1 count, C2 doesn't, dial-less pass takes B/SA's index",
    order.join(" ") === "501:10.3:11.25 503:10.4:11.25 502:9.85:10.7 504:12:12.5",
    order.join(" "),
  );
  check("stock: an unnamed, unclassed car number stays off the sheet", !q.qualifiers.some((e) => e.car === "599"));
  check("stock: Low ET is the number one qualifier's", lines(q.content)[1] === "Low ET 10.300 501 Driver 501", lines(q.content)[1]);
}

// ——— 6. Heads-up: TD with dial-ins on its passes still qualifies on ET; MPH columns ———
{
  const cat = "TOP DRAGSTER";
  const td = (h: string, car: string, et: number, mph: number, dial: number | null) =>
    pass("Q1", `06/18/2026 ${h}`, car, et, { category: cat, class_index: "TD", dial_in: dial, mph_1320: mph });
  const rows: RunRow[] = [
    td("10:00:00 AM", "601", 6.106, 228.92, null),
    pass("Q2", "06/18/2026 01:00:00 PM", "601", 6.125, { category: cat, class_index: "TD", dial_in: 6.85, mph_1320: 230.5 }),
    td("10:01:00 AM", "602", 6.2, 225.0, 6.9),
  ];
  const q = buildDataOutExport(rows, [], {}).qdat.find((f) => f.category === cat)!;
  const l = lines(q.content);
  check("heads-up: quickest ET wins whatever the dial-in column says", q.qualifiers[0].et === 6.106, String(q.qualifiers[0].et));
  check("heads-up: ET, that pass's MPH, best MPH", l[3].endsWith(",6.106,228.92,230.50"), l[3]);
}

// ——— 7. Juniors qualify on the tree ———
{
  const cat = "JR DRAGSTER 6-10";
  const jr = (round: string, h: string, car: string, rt: number) =>
    run({ round, timestamp: `06/18/2026 ${h}`, car_number: car, name: `Driver ${car}`, category: cat, class_index: "JD", rt, ft660: 11.9, mph_660: 53 });
  const rows = [jr("Q1", "09:00:00 AM", "701", 0.046), jr("Q2", "11:00:00 AM", "701", 0.019), jr("Q1", "09:01:00 AM", "702", -0.009), jr("Q1", "09:02:00 AM", "703", 0.1)];
  const q = buildDataOutExport(rows, [], {}).qdat.find((f) => f.category === cat)!;
  const l = lines(q.content);
  check("juniors: best reaction time, red lights last", q.qualifiers.map((e) => e.car).join(" ") === "701 703 702", q.qualifiers.map((e) => e.car).join(" "));
  check("juniors: the RT prints in the ET column, a 4-space index", l[3].endsWith(",0.019,    ,0.019") && l[5].endsWith(",-0.009,    ,-0.009"), l.join(" | "));
}

// ——— 8. Placeholders, eighth-mile majority ———
{
  const cat = "SUPER STOCK";
  const rows = [
    pass("E1", T("10:00:00 AM"), "801", 99.999, { category: cat, class_index: "SS/JA", dial_in: 1, mph_1320: 1 }, true),
    pass("E1", T("10:00:00 AM"), "802", 10.1, { category: cat, class_index: "SS/JA", dial_in: 10.0 }),
  ];
  const l = lines(buildDataOutExport(rows, [], {}).edat[0].content);
  const f = l.find((x) => x.startsWith("801,"))!.split(",");
  check("placeholders: 99.999 / 1.00 print as no time, a lone-digit dial as no dial", f[9] === "" && f[10] === "" && f[11] === "", f.join(","));

  const jcat = "ADVANCED JR";
  const eighth: RunRow[] = [];
  for (let i = 0; i < 6; i++) {
    eighth.push(
      run({ round: "E1", timestamp: T(`10:0${i}:00 AM`), car_number: `9${i}0`, name: "X", category: jcat, rt: 0.02, ft660: 7.9 + i / 100, mph_660: 80, dial_in: 7.9, is_winner: 1, result: "W" }),
      run({ round: "E1", timestamp: T(`10:0${i}:00 AM`), car_number: `9${i}1`, name: "Y", category: jcat, rt: 0.03, ft660: 8.1, mph_660: 78, dial_in: 8.0, lane: "R", ft1320: i === 0 ? 29.463 : null }),
    );
  }
  const jl = lines(buildDataOutExport(eighth, [], {}).edat[0].content);
  check("eighth-mile: a stray 1320 reading doesn't blank the class's ETs", jl[2].endsWith(", 7.900, 80.00"), jl[2]);
}

// ——— 9. Portatree dialect ———
{
  const cat = "COMPETITION ELIMINATOR";
  const rows: RunRow[] = [
    pass("E1", T("12:35:29 PM"), "17", 9.118, { qual_pos: 5, class_index: "F/D", dial_in: 8.51, rt: null, ft60: 2.129 }, true),
    pass("E1", T("12:35:29 PM"), "1890", null, { qual_pos: 3, class_index: "K/AA", dial_in: 8.12, rt: null, lane: "R", mph_1320: null }),
    pass("E1", T("12:37:02 PM"), "3", 9.32581, { qual_pos: 1, class_index: "I/SM", dial_in: 9.48, rt: 0.05581 }, true),
    run({ round: "E1", timestamp: T("12:37:02 PM"), car_number: "BYE", qual_pos: 0, dial_in: 0, lane: "R" }),
    pass("E2", T("01:50:50 PM"), "3", 8.929, { qual_pos: 1, class_index: "I/SM", dial_in: 9.48, rt: -0.02348 }, true),
    pass("E2", T("01:50:50 PM"), "17", 7.999, { qual_pos: null, class_index: "F/D", dial_in: 8.51, rt: 0.035, lane: "R" }),
  ];
  check("Portatree detected from the BYE car", detectTimingSystem(rows) === "portatree");
  const edat = buildDataOutExport(rows, [], { timing: "portatree" }).edat[0];
  const l = lines(edat.content);
  check("Portatree: header", l[0] === "Portatree COMPETITION ELIMINATOR Elimination Results", l[0]);
  check("Portatree: a finished pass with no RT is -0.500", l.some((x) => x.startsWith("17,") && x.endsWith(",-0.500,8.51,9.118,153.54")), edat.content);
  check("Portatree: no run at all is 0.000 across the board", l.some((x) => x.endsWith(",0.000,8.12,0.000,0.00")), edat.content);
  check("Portatree: raw readings are cut, not rounded", l.some((x) => x.startsWith("3,") && x.includes(",0.055,9.48,9.325,")), edat.content);
  check("Portatree: a raw red light is cut down", l.some((x) => x.includes(",-0.024,9.48,8.929,")), edat.content);
  check("Portatree: SINGLE marker without the 0", l.includes("SINGLE,0,,,,,,,,,,"), edat.content);
  check("Portatree: no BYE racer line", !l.some((x) => x.startsWith("BYE,")));
  check("Portatree: a blank qualifying position stays blank", l.some((x) => x.startsWith("17,0,F/D,,")), edat.content);
  check("Portatree: the final is headed ROUND 2", l.includes("ROUND 2") && !l.includes("FINALS"), l.join(" | "));
  check("truncFixed cuts down", truncFixed(0.11881, 3) === "0.118" && truncFixed(-0.02348, 3) === "-0.024" && truncFixed(9.118, 3) === "9.118");
}

// ——— 10. Pinned ladder: the tower's numbers pin, withdrawals fill gaps, DQs drop ———
{
  const cat = "SUPER STOCK";
  const ss = (round: string, h: string, car: string, et: number, pos: number) =>
    pass(round, `06/18/2026 ${h}`, car, et, { category: cat, class_index: "SS/AH", dial_in: 10.0, qual_pos: pos });
  const rows: RunRow[] = [
    ss("Q1", "09:00:00 AM", "1001", 9.0, 0),
    ss("Q1", "09:01:00 AM", "1002", 9.2, 0),
    ss("Q1", "09:02:00 AM", "1003", 9.25, 0), // withdrew before round 1: fills the gap at 3
    ss("Q1", "09:03:00 AM", "1004", 9.3, 0),
    ss("Q1", "09:04:00 AM", "1005", 8.5, 0), // DQ'd (getresults never shows it): the tower ranked it last
    ss("E1", "02:00:00 PM", "1001", 9.1, 1),
    ss("E1", "02:00:00 PM", "1004", 9.4, 4),
    ss("E1", "02:01:00 PM", "1002", 9.2, 2),
  ];
  const q = buildDataOutExport(rows, [], {}).qdat.find((f) => f.category === cat)!;
  check("ladder: pinned numbers, a withdrawal in its gap, a contradicted car last", q.qualifiers.map((e) => e.car).join(" ") === "1001 1002 1003 1004 1005", q.qualifiers.map((e) => e.car).join(" "));
}

// ——— 11. Run selection: date window, a re-run round 1, a pass before round 1 ———
{
  const cat = "NOVICE JR";
  const nj = (round: string, ts: string, car: string, win: boolean) =>
    run({ round, timestamp: ts, car_number: car, name: `Driver ${car}`, category: cat, rt: 0.02, ft660: 12, is_winner: win ? 1 : 0, result: win ? "W" : null, start_date: "20260411" });
  const rows: RunRow[] = [
    // A week earlier: another event entirely.
    nj("E1", "04/02/2026 10:00:00 AM", "1101", true),
    // Friday: the other race of the doubleheader (same cars, round 1 again on Sunday).
    nj("E1", "04/10/2026 10:00:00 AM", "1101", true),
    nj("E1", "04/10/2026 10:00:00 AM", "1102", false),
    nj("E2", "04/11/2026 10:00:00 AM", "1101", true),
    // Sunday: the event's own race.
    nj("E1", "04/12/2026 10:00:00 AM", "1101", false),
    nj("E1", "04/12/2026 10:00:00 AM", "1102", true),
    run({ round: "E5", timestamp: "04/10/2026 07:24:00 AM", car_number: "1201", category: "STOCK ELIMINATOR", start_date: "20260411" }),
    run({ round: "E1", timestamp: "04/11/2026 02:00:00 PM", car_number: "1201", category: "STOCK ELIMINATOR", start_date: "20260411" }),
  ];
  const sel = selectDataOutRuns(rows);
  const juniors = sel.runs.filter((r) => r.category === cat).map((r) => `${r.round}@${r.timestamp?.slice(0, 5)}`);
  check("selection: another week is left out by the date window", sel.dropped.outsideWindow === 1, JSON.stringify(sel.dropped));
  check("selection: the doubleheader's other race is left out", JSON.stringify(juniors) === JSON.stringify(["E1@04/12", "E1@04/12"]), JSON.stringify(juniors));
  check("selection: an elimination pass dated before round 1 is left out", !sel.runs.some((r) => r.round === "E5"), JSON.stringify(sel.dropped));
  check("selection: every leave-out is named", sel.warnings.length === 3, JSON.stringify(sel.warnings));
}

// ——— 12. Class numbers ———
{
  const nums = assignCompulinkClassNumbers([
    { className: "FUNNY CAR", classCode: "FC" },
    { className: "2FAST2TASTY FC CHALLENGE", classCode: "FC" },
    { className: "JR 6-10", classCode: "JD", preset: 3 },
    { className: "JR 11-18", classCode: "JD" },
  ]);
  check("class numbers: 2Fast2Tasty FC takes the national tower's 21, not FC's 2", nums[1] === 21, JSON.stringify(nums));
  check("class numbers: a pinned C# wins; the rest take free slots", nums[2] === 3 && nums[3] === 1, JSON.stringify(nums));
}

// ——— 13. Points files ———
{
  const cat = "SUPER STREET";
  const sst = (round: string, h: string, car: string, win: boolean) =>
    pass(round, T(h), car, 10.95, { category: cat, class_index: "SST", dial_in: 10.9 }, win);
  const rows: RunRow[] = [
    sst("E1", "10:00:00 AM", "1301", true),
    sst("E1", "10:00:00 AM", "1302", false),
    sst("E1", "10:02:00 AM", "1303", true),
    sst("E1", "10:02:00 AM", "1304", false),
    sst("E2", "01:00:00 PM", "1303", true),
    sst("E2", "01:00:00 PM", "1301", false),
    // Ran a time trial, never raced: the 10 entry points.
    pass("T1", "06/18/2026 09:00:00 AM", "1305", 11.0, { category: cat, class_index: "SST", dial_in: 10.9 }),
  ];
  const art = buildDataOutArtifacts(rows, [], { pdfs: false, pointsRaceCode: "91" });
  const p = art.points.find((f) => f.category === cat)!;
  const pl = lines(p.content);
  check("points: named C10A91DP.TXT", p.filename === "C10A91DP.TXT", p.filename);
  check(
    "points: a 4-car field pays winner 85, runner-up 64, round-1 losers 33 in round-1 order, entrant 10",
    JSON.stringify(pl.slice(1, 6).map((x) => x.split(",")[0] + ":" + x.split(",")[4])) ===
      JSON.stringify(["1303:85", "1301:64", "1302:33", "1304:33", "1305:10"]),
    pl.join(" | "),
  );
  check("points: Compulink layout", pl[0] === "Compulink StarTrak EVENT Points for SUPER STREET w/REG code 1" && p.content.endsWith("End of File\r\n\x1a"));
  const pt = buildPointsFileContent(cat, [{ car_number: "1", member_number: "2", name: "A", division: "4", points: 85 }], { portatree: true });
  check("points: Portatree layout", pt.startsWith("Portatree EVENT Points for SUPER STREET w/REG code 1\r\n") && pt.endsWith("\r\nEnd of File " + "\x1a".repeat(106)));
  check("points: none without a race code", buildDataOutArtifacts(rows, [], { pdfs: false }).points.length === 0);
}

// ——— 14. Ctrl-Z record padding ———
{
  const padded = racedataFileText("End of File\r\n", "compulink");
  check("Compulink files fill the last 128-byte record with Ctrl-Z", padded.length === 128 && padded.endsWith("\x1a"));
  check("Portatree files carry no padding", racedataFileText("End of File\r\n", "portatree") === "End of File\r\n");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll Data Out fixture checks passed.");
