/**
 * Regression checks for thrown-out (ignored) runs and the race-day filter — no
 * test framework in this repo, so this is a plain script:
 * `npx tsx scripts/run-visibility-check.ts`. Exits non-zero if any check fails.
 *
 * The fixture mirrors D3 event 38 (Lucas Oil, 10/07/2026), where Best Losing
 * Package for Super Stock round 1 put a 10/03 loss from the previous weekend at
 * #1 — getresults had listed that weekend under the new event — while the four
 * 10/07 6 o'clock passes thrown out on the Runs page were never filtered either.
 * Racer names are placeholders; times, dials and ETs follow the real passes.
 */
import {
  computeBestLosingPackage,
  excludeIgnoredRuns,
  normalizeDedupKey,
  planMisfiledMove,
  type RunRow,
} from "../src/lib/db";
import { eventWindow, inEventWindow, raceDayOf, raceDaysOf, resolveRaceDay } from "../src/lib/race-day";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function run(p: Partial<RunRow>): RunRow {
  return {
    timestamp: null,
    round: "E1",
    qual_pos: null,
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
    category: "SUPER STOCK",
    lane: "L",
    dial_in: null,
    event_code: "38",
    event_name: "Lucas Oil Drag Racing Series 10/07/2026",
    event_type: "D3",
    season: "2026",
    start_date: "20261007",
    ...p,
  };
}

const names = (rows: { name: string }[] | undefined) => (rows || []).map((e) => e.name).join(", ");

console.log("Ignored keys");
{
  check(
    "a 24-hour key normalizes to the live 12-hour shape",
    normalizeDedupKey("20261007182224|39|E1|1|38|2026") === "20261007062224|39|E1|1|38|2026",
  );
  check(
    "a morning key passes through unchanged",
    normalizeDedupKey("20261008112414|3391|E1|1|38|2026") === "20261008112414|3391|E1|1|38|2026",
  );

  const stored = run({ timestamp: "10/07/2026 06:22:24 PM", car_number: "39", _dedup_key: "20261007062224|39|E1|1|38|2026" });
  const keep = run({ timestamp: "10/08/2026 11:24:14 AM", car_number: "3391", _dedup_key: "20261008112414|3391|E1|1|38|2026" });
  const legacyList = new Set(["20261007182224|39|E1|1|38|2026"]);
  const out = excludeIgnoredRuns([stored, keep], legacyList);
  check("an afternoon pass ignored under a 24-hour key is dropped", !out.includes(stored));
  check("passes not on the list are kept", out.length === 1 && out[0] === keep);

  const scraped = run({ timestamp: "10/07/2026 06:22:24 PM", car_number: "39", lane: "L" });
  check(
    "a freshly scraped pass (no _dedup_key yet) is matched by its computed key",
    excludeIgnoredRuns([scraped], new Set(["20261007062224|39|E1|1|38|2026"])).length === 0,
  );
  const all = [stored, keep];
  check("an empty list returns the runs untouched", excludeIgnoredRuns(all, new Set()) === all);
}

console.log("Race day of a pass");
{
  const day = (timestamp: string | null, start_date: string | null = null) => raceDayOf({ timestamp, start_date });
  check("morning pass", day("10/08/2026 11:24:14 AM") === "2026-10-08");
  check("6 o'clock evening pass stays on its date", day("10/07/2026 06:22:24 PM") === "2026-10-07");
  check("a pass after midnight belongs to the night before", day("10/09/2026 12:05:00 AM") === "2026-10-08");
  check("3 AM is still the night before", day("10/09/2026 3:40:10 AM") === "2026-10-08");
  check("6:30 AM starts a new race day", day("10/09/2026 6:30:00 AM") === "2026-10-09");
  check("an untagged small hour is never pulled back a day", day("10/09/2026 1:30:00") === "2026-10-09");
  check("EData's synthetic round past midnight stays on the race date", day("10/9/2026 12:00:07 AM") === "2026-10-08");
  check("no timestamp: the scrape's start date (YYYYMMDD)", day(null, "20261007") === "2026-10-07");
  check("time-only timestamp: the import's start date (ISO)", day("11:24:14", "2026-10-07") === "2026-10-07");
  check("date-only timestamp", day("10/06/2026") === "2026-10-06");
  check("nothing dates it", day(null) === "");
}

console.log("Resolving race_day");
{
  const candidates = [
    { timestamp: "10/03/2026 10:03:37 AM" },
    { timestamp: "10/07/2026 06:22:24 PM" },
    { timestamp: "10/08/2026 11:24:14 AM" },
  ];
  check("default = latest day the candidates ran", resolveRaceDay(undefined, candidates) === "2026-10-08");
  check('"latest" = latest day', resolveRaceDay("latest", candidates) === "2026-10-08");
  check('"all" = no day filter', resolveRaceDay("all", candidates) === null);
  check("an explicit day passes through", resolveRaceDay("2026-10-03", candidates) === "2026-10-03");
  check("no candidates = no day filter", resolveRaceDay(undefined, []) === null);
  const days = raceDaysOf([...candidates, { timestamp: "10/08/2026 11:21:21 AM" }]);
  check(
    "day list is oldest first with counts",
    JSON.stringify(days) ===
      JSON.stringify([
        { day: "2026-10-03", runs: 1 },
        { day: "2026-10-07", runs: 1 },
        { day: "2026-10-08", runs: 2 },
      ]),
    JSON.stringify(days),
  );
}

console.log("Best Losing Package, Super Stock round 1 (event 38 shape)");
{
  const ignoredList = new Set([
    // Written while keys carried the hour 24-hour — must still match.
    "20261007182224|39|E1|1|38|2026",
    "20261007062224|531X|E1|2|38|2026",
  ]);
  const runs: RunRow[] = [
    // Previous weekend (10/03), listed by getresults under this event.
    run({ timestamp: "10/03/2026 09:34:29 AM", car_number: "55", name: "Prior Weekend B", rt: 0.096, ft1320: 9.609, dial_in: 9.59, lane: "R" }),
    run({ timestamp: "10/03/2026 10:03:37 AM", car_number: "39", name: "Racer H", rt: 0.038, ft1320: 9.439, dial_in: 9.43, lane: "R" }),
    // Wednesday 6 o'clock session, thrown out on the Runs page.
    run({ timestamp: "10/07/2026 06:22:24 PM", car_number: "39", name: "Racer H", rt: 0.023, ft1320: 9.549, dial_in: 9.53, is_winner: 1, result: "W" }),
    run({ timestamp: "10/07/2026 06:22:24 PM", car_number: "531X", name: "Racer D", rt: 0.035, ft1320: 10.352, dial_in: 10.33, lane: "R" }),
    // Today's real round 1.
    run({ timestamp: "10/08/2026 10:30:36 AM", car_number: "39", name: "Racer H", rt: 0.126, ft1320: 9.556, dial_in: 9.46, is_winner: 1, result: "W" }),
    run({ timestamp: "10/08/2026 10:30:36 AM", car_number: "3157", name: "Breakout Loser", rt: 0.013, ft1320: 10.409, dial_in: 10.5, lane: "R" }),
    run({ timestamp: "10/08/2026 11:21:21 AM", car_number: "4312", name: "Racer P", rt: 0.06, ft1320: 9.056, dial_in: 9.05, lane: "R" }),
    run({ timestamp: "10/08/2026 11:24:14 AM", car_number: "3391", name: "Racer S", rt: 0.042, ft1320: 10.27, dial_in: 10.26 }),
    run({ timestamp: "10/08/2026 11:25:42 AM", car_number: "5600", name: "Red Light", rt: -0.023, ft1320: 10.769, dial_in: 8.67, lane: "R" }),
  ];
  for (const r of runs) {
    const h = r.timestamp!.split(" ")[1].split(":");
    const hour12 = String(parseInt(h[0], 10) % 12).padStart(2, "0");
    const [mo, d, y] = r.timestamp!.split(" ")[0].split("/");
    r._dedup_key = `${y}${mo}${d}${hour12}${h[1]}${h[2]}|${r.car_number}|E1|${r.lane === "R" ? 2 : 1}|38|2026`;
  }

  const visible = excludeIgnoredRuns(runs, ignoredList);
  check("both thrown-out 6 o'clock passes are gone", visible.length === runs.length - 2);

  const byDefault = computeBestLosingPackage(visible, ["E1"], ["SUPER STOCK"]);
  check("default covers the latest day round 1 ran", byDefault.raceDay === "2026-10-08", String(byDefault.raceDay));
  check(
    "default list is today's losers only, best package first",
    names(byDefault.results["SUPER STOCK"]) === "Racer S, Racer P",
    names(byDefault.results["SUPER STOCK"]),
  );

  const allDays = computeBestLosingPackage(visible, ["E1"], ["SUPER STOCK"], "all");
  check("All Days still finds the previous weekend's pass", names(allDays.results["SUPER STOCK"]).startsWith("Racer H"));
  check("All Days never brings back a thrown-out pass", !names(allDays.results["SUPER STOCK"]).includes("Racer D"));

  const raw = computeBestLosingPackage(runs, ["E1"], ["SUPER STOCK"], "all");
  check(
    "without the ignore filter the thrown-out pass would rank (the old behaviour)",
    names(raw.results["SUPER STOCK"]).includes("Racer D"),
  );

  const wednesday = computeBestLosingPackage(visible, ["E1"], ["SUPER STOCK"], "2026-10-07");
  check("Wednesday has nothing left once its passes are thrown out", !wednesday.results["SUPER STOCK"]);

  const prior = computeBestLosingPackage(visible, ["E1"], ["SUPER STOCK"], "2026-10-03");
  check(
    "an explicit day shows that day alone",
    names(prior.results["SUPER STOCK"]) === "Racer H, Prior Weekend B",
    names(prior.results["SUPER STOCK"]),
  );

  const lateNight = [
    ...visible,
    run({ timestamp: "10/08/2026 11:50:10 PM", round: "E2", car_number: "77", name: "Late Pair A", rt: 0.05, ft1320: 9.51, dial_in: 9.5 }),
    run({ timestamp: "10/09/2026 12:05:00 AM", round: "E2", car_number: "78", name: "After Midnight", rt: 0.02, ft1320: 9.505, dial_in: 9.5 }),
  ];
  const e2 = computeBestLosingPackage(lateNight, ["E2"], ["SUPER STOCK"]);
  check("a round that ran past midnight stays on its race day", e2.raceDay === "2026-10-08", String(e2.raceDay));
  check("and keeps its after-midnight passes", names(e2.results["SUPER STOCK"]) === "After Midnight, Late Pair A");
}

console.log("Event date window (scrape guard + quarantine)");
{
  const window = eventWindow("20261007");
  check("window runs from the test day before through start + 5", JSON.stringify(window) === '{"from":"2026-10-06","to":"2026-10-12"}', JSON.stringify(window));
  check("ISO start dates read the same", JSON.stringify(eventWindow("2026-10-07")) === JSON.stringify(window));
  check("no start date, no window", eventWindow("") === null && inEventWindow({ timestamp: "10/03/2026 9:30:51 AM" }, null));
  const day = (timestamp: string | null) => inEventWindow({ timestamp, start_date: "20261007" }, window);
  check("the previous weekend (Midwest Nationals 10/03) is outside", !day("10/03/2026 09:30:51 AM"));
  check("10/05, the day before the test day, is outside", !day("10/05/2026 10:00:00 AM"));
  check("the Tuesday test day is inside", day("10/06/2026 03:10:00 PM"));
  check("race days are inside", day("10/07/2026 06:22:24 PM") && day("10/08/2026 11:24:14 AM"));
  check("a Monday rain day is inside", day("10/12/2026 10:00:00 AM"));
  check("the week after is outside", !day("10/13/2026 10:00:00 AM"));
  check("an undated pass is never ruled out", day(null));

  const nats = run({ timestamp: "10/03/2026 09:30:51 AM", car_number: "3307", category: "SUPER STOCK" });
  const natsTf = run({ timestamp: "10/04/2026 02:15:00 PM", car_number: "1", category: "TOP FUEL" });
  const test = run({ timestamp: "10/06/2026 03:10:00 PM", round: "T", car_number: "39" });
  const today = run({ timestamp: "10/08/2026 11:24:14 AM", car_number: "3391" });
  const plan = planMisfiledMove(
    [
      { id: "mixed", runs: [nats, today, natsTf] },
      { id: "clean", runs: [test, today] },
      { id: "foreign", runs: [{ ...nats }] },
    ],
    window,
  );
  check("only batch docs holding out-of-window rows are touched", plan.moves.map((m) => m.id).join(",") === "mixed,foreign");
  const mixed = plan.moves.find((m) => m.id === "mixed")!;
  check("a mixed doc keeps its in-window rows", mixed.keep.length === 1 && mixed.keep[0] === today && mixed.move.length === 2);
  check("a fully foreign doc is emptied, not dropped", plan.moves.find((m) => m.id === "foreign")!.keep.length === 0);
  check(
    "per-day report counts stored rows and distinct passes",
    JSON.stringify(plan.days) ===
      JSON.stringify([
        { day: "2026-10-03", rows: 2, passes: 1, inWindow: false },
        { day: "2026-10-04", rows: 1, passes: 1, inWindow: false },
        { day: "2026-10-06", rows: 1, passes: 1, inWindow: true },
        { day: "2026-10-08", rows: 2, passes: 1, inWindow: true },
      ]),
    JSON.stringify(plan.days),
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
