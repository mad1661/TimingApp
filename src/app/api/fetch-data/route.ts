import { NextRequest, NextResponse } from "next/server";
import { loginAndFetch } from "@/lib/scraper";
import { insertRuns, insertEvent, logFetch, purgeEventRuns } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, season, eventType, eventCode, startDate, eventName, dateFilter, purge } = body;

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }
    if (!season || !eventType || !eventCode || !startDate || !eventName) {
      return NextResponse.json({ error: "Event details are required" }, { status: 400 });
    }

    if (purge) {
      const purged = await purgeEventRuns(eventCode, season);
      console.log(`[FetchData] Purged ${purged} batch docs for ${eventCode} season ${season}`);
    }

    const runs = await loginAndFetch({ username, password, season, eventType, eventCode, startDate, eventName, dateFilter });
    console.log(`[FetchData] Scraped ${runs.length} runs for event ${eventCode} (${eventName}), season ${season}, type ${eventType}`);

    await insertEvent({ event_code: eventCode, event_type: eventType, event_name: eventName, season, start_date: startDate });
    const inserted = await insertRuns(eventCode, season, runs);
    if (inserted > 0) {
      await logFetch(eventCode, season, eventType, inserted);
    }
    console.log(`[FetchData] Inserted ${inserted} new runs (${runs.length} total parsed)`);

    return NextResponse.json({ success: true, totalParsed: runs.length, inserted, purged: !!purge });
  } catch (error) {
    console.error("Fetch data error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch data" },
      { status: 500 }
    );
  }
}
