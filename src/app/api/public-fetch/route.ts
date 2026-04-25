import { NextRequest, NextResponse } from "next/server";
import { loginAndFetch, invalidateSession } from "@/lib/scraper";
import { getEvents, insertEvent, insertRuns, getScheduleData, getDistinctRounds, getCategories, invalidateEventCache } from "@/lib/db";

export const dynamic = "force-dynamic";

function parseStartDate(s: string | null | undefined): number {
  if (!s) return 0;
  const d = new Date(s);
  const t = d.getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * Public, credential-less fetch endpoint. Uses the NHRA_USERNAME and
 * NHRA_PASSWORD env vars (the ones already wired up in apphosting.yaml) to
 * scrape getresults.nhradata.com and refresh whatever event was most recently
 * tracked. Returns the schedule for that event so the /share page can render
 * it without ever touching a credential client-side.
 */
export async function POST(req: NextRequest) {
  try {
    const username = process.env.NHRA_USERNAME;
    const password = process.env.NHRA_PASSWORD;
    if (!username || !password) {
      return NextResponse.json(
        { error: "Server credentials not configured (NHRA_USERNAME / NHRA_PASSWORD)" },
        { status: 503 },
      );
    }

    let body: { event_code?: string; season?: string } | null = null;
    try { body = await req.json(); } catch { body = null; }

    const all = await getEvents();
    if (all.length === 0) {
      return NextResponse.json(
        { error: "No event has been registered yet. Open the main app once with credentials so an event can be picked up." },
        { status: 404 },
      );
    }

    let event = all[0];
    if (body?.event_code && body?.season) {
      const match = all.find((e) => e.event_code === body!.event_code && e.season === body!.season);
      if (match) event = match;
    } else {
      // Pick the most recently scheduled event (latest start_date).
      event = [...all].sort((a, b) => parseStartDate(b.start_date) - parseStartDate(a.start_date))[0];
    }

    // Drop this worker's in-memory cache before scraping so any runs written
    // by a different worker since this worker last loaded are observed too.
    invalidateEventCache(event.event_code, event.season);
    // Also drop any cached scraper session so we don't reuse a session whose
    // form state has a stuck dateFilter (e.g. the main app set it to Friday)
    // that would prevent today's runs from being returned.
    invalidateSession(username);

    let inserted = 0;
    let scrapeError: string | null = null;
    try {
      const runs = await loginAndFetch({
        username,
        password,
        season: event.season,
        eventType: event.event_type,
        eventCode: event.event_code,
        startDate: event.start_date,
        eventName: event.event_name,
        // Explicitly omit dateFilter so the scraper requests the event's full
        // run table, not a single day filtered by the main app's saved value.
      });
      // Make sure the event row exists / re-register
      await insertEvent({
        event_code: event.event_code,
        event_type: event.event_type,
        event_name: event.event_name,
        season: event.season,
        start_date: event.start_date,
      });
      inserted = await insertRuns(event.event_code, event.season, runs);
    } catch (err) {
      scrapeError = err instanceof Error ? err.message : String(err);
      console.error("[public-fetch] scrape failed:", scrapeError);
    }

    const [schedule, rounds, categories] = await Promise.all([
      getScheduleData(event.event_code, event.season),
      getDistinctRounds(event.event_code, event.season),
      getCategories(event.event_code, event.season),
    ]);

    return NextResponse.json({
      event,
      schedule,
      rounds,
      categories,
      inserted,
      scrapeError,
      fetchedAt: new Date().toISOString(),
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (err) {
    console.error("[public-fetch] error:", err);
    return NextResponse.json({ error: "Failed to refresh public schedule" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
