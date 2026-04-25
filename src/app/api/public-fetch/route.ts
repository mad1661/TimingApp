import { NextRequest, NextResponse } from "next/server";
import { loginAndFetch, fetchEventDates, invalidateSession, type NhraEvent } from "@/lib/scraper";
import { getEvents, insertEvent, insertRuns, getScheduleData, getDistinctRounds, getCategories, invalidateEventCache, type RunRow } from "@/lib/db";

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
    let scrapedRunCount = 0;
    const scrapedDateCounts: Record<string, number> = {};
    let scrapedLatestTimestamp: string | null = null;
    const datesScraped: string[] = [];
    try {
      // Get the list of dates the event has in its date dropdown so we can
      // fetch each one explicitly. Without this, getresults sometimes returns
      // a single day's view (typically the originally-selected day) and we
      // never see today's runs even after a full re-login.
      const nhraEvent: NhraEvent = {
        eventType: event.event_type,
        startDate: event.start_date,
        eventCode: event.event_code,
        season: event.season,
        displayName: event.event_name,
      };
      let dates: { value: string; label: string }[] = [];
      try {
        dates = await fetchEventDates(username, password, nhraEvent);
      } catch (err) {
        console.error("[public-fetch] fetchEventDates failed:", err);
      }

      const allRuns: Omit<RunRow, "id" | "created_at">[] = [];

      if (dates.length === 0) {
        // Fall back to a single no-filter scrape if we couldn't enumerate dates.
        const runs = await loginAndFetch({
          username,
          password,
          season: event.season,
          eventType: event.event_type,
          eventCode: event.event_code,
          startDate: event.start_date,
          eventName: event.event_name,
        });
        allRuns.push(...runs);
      } else {
        for (const d of dates) {
          datesScraped.push(d.value);
          try {
            const runs = await loginAndFetch({
              username,
              password,
              season: event.season,
              eventType: event.event_type,
              eventCode: event.event_code,
              startDate: event.start_date,
              eventName: event.event_name,
              dateFilter: d.value,
            });
            allRuns.push(...runs);
          } catch (err) {
            console.error(`[public-fetch] scrape failed for date ${d.value}:`, err);
          }
        }
      }

      scrapedRunCount = allRuns.length;
      for (const r of allRuns) {
        if (!r.timestamp) continue;
        const day = r.timestamp.split(" ")[0] || "";
        if (!day) continue;
        scrapedDateCounts[day] = (scrapedDateCounts[day] || 0) + 1;
        if (!scrapedLatestTimestamp || r.timestamp > scrapedLatestTimestamp) {
          scrapedLatestTimestamp = r.timestamp;
        }
      }

      // Make sure the event row exists / re-register
      await insertEvent({
        event_code: event.event_code,
        event_type: event.event_type,
        event_name: event.event_name,
        season: event.season,
        start_date: event.start_date,
      });
      inserted = await insertRuns(event.event_code, event.season, allRuns);
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
      datesScraped,
      scrapedRunCount,
      scrapedDateCounts,
      scrapedLatestTimestamp,
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
