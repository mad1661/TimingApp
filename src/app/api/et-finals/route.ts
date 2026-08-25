import { NextRequest, NextResponse } from "next/server";
import { getEtFinalsStandings } from "@/lib/db";

// Standings are recomputed from the current runs on every request; caching them
// would put yesterday's round on the board.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const eventCode = params.get("event_code");
  const season = params.get("season");

  if (!eventCode || !season) {
    return NextResponse.json({ error: "event_code and season are required" }, { status: 400 });
  }

  try {
    const standings = await getEtFinalsStandings(eventCode, season);
    return NextResponse.json(standings, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    console.error("ET Finals standings error:", err);
    return NextResponse.json({ error: "Failed to compute standings" }, { status: 500 });
  }
}
