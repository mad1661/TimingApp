import { NextRequest, NextResponse } from "next/server";
import {
  nhraLogin,
  listEventsWithCookies,
  scrapeEventWithCookies,
  type NhraEvent,
} from "@/lib/scraper";
import { insertEvent, insertRuns, invalidateEventCache } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

function evKey(e: NhraEvent): string {
  return `${e.season}|${e.eventType}|${e.eventCode}|${e.startDate}`;
}

// Browser-driven backfill. The client loops over (season, eventType) calling
// mode "list", then feeds events back in small batches via mode "events".
// Keeping each request to one login + a few events stays within the serverless
// request timeout while the page shows live progress.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, mode } = body;

    if (!username || !password) {
      return NextResponse.json({ error: "NHRA username and password are required" }, { status: 400 });
    }

    const cookies = await nhraLogin(username, password);

    if (mode === "list") {
      const { season, eventType } = body;
      if (!season || !eventType) {
        return NextResponse.json({ error: "season and eventType are required" }, { status: 400 });
      }
      const events = await listEventsWithCookies(cookies, season, eventType);
      return NextResponse.json({ success: true, events }, { headers: NO_STORE_HEADERS });
    }

    if (mode === "events") {
      const events: NhraEvent[] = Array.isArray(body.events) ? body.events : [];
      const results: { key: string; scraped?: number; inserted?: number; error?: string }[] = [];
      for (const ev of events) {
        const key = evKey(ev);
        try {
          const runs = await scrapeEventWithCookies(cookies, ev);
          invalidateEventCache(ev.eventCode, ev.season);
          await insertEvent({
            event_code: ev.eventCode,
            event_type: ev.eventType,
            event_name: ev.displayName,
            season: ev.season,
            start_date: ev.startDate,
          });
          const inserted = await insertRuns(ev.eventCode, ev.season, runs);
          results.push({ key, scraped: runs.length, inserted });
        } catch (err) {
          results.push({ key, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return NextResponse.json({ success: true, results }, { headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backfill request failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
