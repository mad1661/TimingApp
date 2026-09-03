import { NextRequest, NextResponse } from "next/server";
import { loginAndFetch, fetchEventList } from "@/lib/scraper";

export const runtime = "nodejs";
export const maxDuration = 120;

// Public read-only endpoint for Mark's standalone tools (e.g. the No Show
// report on markdawson-playground). Uses the server-side getresults
// credentials — they are never exposed to the caller.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: NextRequest) {
  try {
    // Secrets can carry a trailing newline from Secret Manager — trim them.
    const username = process.env.NHRA_USERNAME?.trim();
    const password = process.env.NHRA_PASSWORD?.trim();
    if (!username || !password) {
      return NextResponse.json({ error: "Server credentials not configured" }, { status: 500, headers: CORS });
    }

    const params = request.nextUrl.searchParams;
    const season = params.get("season") || String(new Date().getFullYear());
    const eventType = params.get("type") || "N";

    if (params.get("list") === "1") {
      const events = await fetchEventList(username, password, season, eventType);
      return NextResponse.json({ events }, { headers: CORS });
    }

    const eventCode = params.get("code") || "";
    const startDate = params.get("start") || "";
    const eventName = params.get("name") || "";
    if (!eventCode || !startDate) {
      return NextResponse.json({ error: "code and start are required (or pass list=1)" }, { status: 400, headers: CORS });
    }

    const runs = await loginAndFetch({ username, password, season, eventType, eventCode, startDate, eventName });
    return NextResponse.json({ runs, count: runs.length }, { headers: CORS });
  } catch (error) {
    console.error("live-runs error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch live runs" },
      { status: 500, headers: CORS }
    );
  }
}
