/**
 * Misfiled runs — dry run, move to quarantine, or restore. The same actions as
 * /api/misfiled-runs, run locally against Firestore with admin credentials
 * (GOOGLE_APPLICATION_CREDENTIALS or the FB_ADMIN_* env vars):
 *
 *   npx tsx scripts/misfiled-runs.ts 38 2026             # dry run (default), writes nothing
 *   npx tsx scripts/misfiled-runs.ts 38 2026 --move      # out-of-window rows -> misfiled_runs
 *   npx tsx scripts/misfiled-runs.ts 38 2026 --restore   # quarantined rows back under the event
 *   ... --start 20261007                                 # override the event's start date
 */
import { getMisfiledPlan, moveMisfiledRuns, restoreMisfiledRuns, type MisfiledPlan } from "../src/lib/db";

function printPlan(plan: MisfiledPlan) {
  console.log(`${plan.event_code}_${plan.season}: start ${plan.start_date ?? "unknown"}, window ${plan.window ? `${plan.window.from}..${plan.window.to}` : "none"}`);
  for (const d of plan.days) {
    console.log(`  ${d.day}  ${String(d.rows).padStart(5)} rows  ${String(d.passes).padStart(5)} passes  ${d.inWindow ? "keep" : "MOVE"}`);
  }
  console.log(
    `  -> ${plan.rowsToMove} rows (${plan.passesToMove} passes) out of window, in ${plan.batchDocsAffected} of ${plan.batchDocs} batch docs`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const [eventCode, season] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--start");
  if (!eventCode || !season) {
    console.error("usage: npx tsx scripts/misfiled-runs.ts <event_code> <season> [--move|--restore] [--start YYYYMMDD]");
    process.exit(2);
  }
  const startIdx = args.indexOf("--start");
  const start = startIdx >= 0 ? args[startIdx + 1] : undefined;

  if (args.includes("--restore")) {
    const { batches, rows } = await restoreMisfiledRuns(eventCode, season);
    console.log(`Restored ${rows} rows from ${batches} quarantine batches to ${eventCode}_${season}`);
  } else if (args.includes("--move")) {
    printPlan(await moveMisfiledRuns(eventCode, season, start));
    console.log("Moved. Undo with --restore.");
  } else {
    printPlan(await getMisfiledPlan(eventCode, season, start));
    console.log("Dry run — nothing written. Add --move to quarantine the rows marked MOVE.");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
