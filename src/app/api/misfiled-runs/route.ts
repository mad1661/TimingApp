import { NextRequest, NextResponse } from "next/server";
import { getMisfiledPlan, moveMisfiledRuns, restoreMisfiledRuns } from "@/lib/db";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

/**
 * Runs stored under an event they don't belong to — dated outside its window
 * (the test day before its start through five days after).
 *
 * GET  /api/misfiled-runs?event_code=&season=[&start_date=YYYYMMDD]
 *      Dry run: stored rows and passes per race day, and what a move would take.
 *      Writes nothing.
 * POST /api/misfiled-runs { event_code, season, action, confirm: true, start_date? }
 *      action "move"    — copy the out-of-window rows into misfiled_runs, then
 *                         take them off the event (never deleted)
 *      action "restore" — put every quarantined row back under the event
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const eventCode = params.get("event_code") || "";
  const season = params.get("season") || "";
  if (!eventCode || !season) {
    return NextResponse.json({ error: "event_code and season are required" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  try {
    const plan = await getMisfiledPlan(eventCode, season, params.get("start_date"));
    return NextResponse.json({ dryRun: true, plan }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("misfiled-runs dry run failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Dry run failed" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { event_code, season, action, confirm, start_date } = await request.json();
    if (!event_code || !season) {
      return NextResponse.json({ error: "event_code and season are required" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (action !== "move" && action !== "restore") {
      return NextResponse.json({ error: 'action must be "move" or "restore"' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (confirm !== true) {
      return NextResponse.json(
        { error: "confirm: true is required — check the GET dry run first" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (action === "move") {
      const plan = await moveMisfiledRuns(event_code, season, start_date);
      return NextResponse.json({ moved: true, plan }, { headers: NO_STORE_HEADERS });
    }
    const restored = await restoreMisfiledRuns(event_code, season);
    return NextResponse.json({ restored }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("misfiled-runs action failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Action failed" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
