import { NextRequest, NextResponse } from "next/server";
import { fetchEventList, fetchEventDates, invalidateSession } from "@/lib/scraper";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, season, eventType, action, event } = body;

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }

    // Don't reuse a stale session for either dropdown call — those cached
    // cookies sometimes belong to a different worker / earlier event and
    // cause the dashboard to come back empty.
    invalidateSession(username);

    if (action === "dates" && event) {
      const dates = await fetchEventDates(username, password, event);
      return NextResponse.json({ success: true, dates });
    }

    const events = await fetchEventList(
      username,
      password,
      season || "2026",
      eventType || "N"
    );

    return NextResponse.json({ success: true, events });
  } catch (error) {
    console.error("Fetch events error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch events" },
      { status: 500 }
    );
  }
}
