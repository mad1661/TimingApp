import { NextRequest, NextResponse } from "next/server";
import { racefilesLogin, listTechCardEvents, scrapeTechCards } from "@/lib/racefiles-scraper";
import { saveTechCards } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

// Browser-driven tech-card backfill from racefiles.nhradata.com. The client
// loops: mode "list" to enumerate events, then mode "events" to scrape and
// upsert a small batch at a time (keeping each request within the timeout).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, mode } = body;

    if (!username || !password) {
      return NextResponse.json({ error: "racefiles username and password are required" }, { status: 400 });
    }

    const cookies = await racefilesLogin(username, password);

    if (mode === "list") {
      const events = await listTechCardEvents(cookies);
      return NextResponse.json({ success: true, events }, { headers: NO_STORE_HEADERS });
    }

    if (mode === "events") {
      const events: string[] = Array.isArray(body.events) ? body.events : [];
      const scraped = await scrapeTechCards(cookies, events);
      const results: { event: string; parsed?: number; saved?: number; error?: string }[] = [];
      for (const r of scraped) {
        if (r.error) {
          results.push({ event: r.event, error: r.error });
          continue;
        }
        const { saved } = await saveTechCards(r.entries);
        results.push({ event: r.event, parsed: r.entries.length, saved });
      }
      return NextResponse.json({ success: true, results }, { headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Tech-card backfill request failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
