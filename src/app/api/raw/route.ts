import { NextRequest, NextResponse } from "next/server";
import {
  getFullEvent,
  getCategoryRuns,
  getLatestRuns,
  mapApiRunsToRunRows,
  toApiStartDate,
  type NhraEventType,
} from "@/lib/nhra-api";
import { getEventRuns } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// Troubleshooting endpoint: returns the raw NHRA API response, what
// mapApiRunsToRunRows() turns it into, and the runs currently stored in
// Firestore — so the three can be compared side by side. Server-only (uses the
// API key + db); reachable only where api.nhra.com is (the deployed app).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { eventType, startDate, season, eventCode, eventName, category, count, mode } = body;
    if (!eventType || !startDate) {
      return NextResponse.json(
        { error: "eventType and startDate are required" },
        { status: 400, headers: NO_STORE },
      );
    }

    const meta = {
      eventCode: eventCode || "",
      eventName: eventName || "",
      eventType,
      season: season || "",
      startDate,
    };
    const sd = toApiStartDate(startDate);

    let apiRaw;
    if (mode === "category" && category) {
      apiRaw = await getCategoryRuns(eventType as NhraEventType, sd, category);
    } else if (mode === "full") {
      apiRaw = await getFullEvent(eventType as NhraEventType, sd);
    } else {
      apiRaw = await getLatestRuns(eventType as NhraEventType, sd, Number(count) || 50);
    }

    const mapped = mapApiRunsToRunRows(apiRaw, meta);
    const stored = eventCode && season ? await getEventRuns(eventCode, season) : [];

    return NextResponse.json(
      {
        apiCount: apiRaw.length,
        mappedCount: mapped.length,
        storedCount: stored.length,
        apiRaw,
        mapped,
        stored,
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch raw data" },
      { status: 500, headers: NO_STORE },
    );
  }
}
