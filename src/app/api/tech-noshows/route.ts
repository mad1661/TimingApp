import { NextRequest, NextResponse } from "next/server";
import { getEventRuns, getEvents, insertRuns, logFetch } from "@/lib/db";
import { loginAndFetch } from "@/lib/scraper";
import { parseTechCards, buildTechNoShowReport } from "@/lib/tech-noshows";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const eventCode = String(form.get("event_code") || "");
    const season = String(form.get("season") || "");
    const skipLive = String(form.get("skip_live") || "") === "1";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No tech card file uploaded" }, { status: 400 });
    }
    if (!eventCode || !season) {
      return NextResponse.json({ error: "event_code and season are required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const cards = parseTechCards(buffer);

    // Pull the latest timing data straight from getresults using the server
    // credentials (NHRA_USERNAME / NHRA_PASSWORD) — no CSV import needed.
    let source: "live" | "stored" = "stored";
    let liveError: string | null = null;
    if (!skipLive) {
      const username = process.env.NHRA_USERNAME;
      const password = process.env.NHRA_PASSWORD;
      const event = (await getEvents()).find((e) => e.event_code === eventCode && e.season === season);
      if (username && password && event) {
        try {
          const scraped = await loginAndFetch({
            username,
            password,
            season,
            eventType: event.event_type,
            eventCode,
            startDate: event.start_date,
            eventName: event.event_name,
          });
          if (scraped.length > 0) {
            const inserted = await insertRuns(eventCode, season, scraped);
            await logFetch(eventCode, season, event.event_type, inserted);
            source = "live";
          }
        } catch (err) {
          liveError = err instanceof Error ? err.message : "live fetch failed";
          console.error("Tech no-show live fetch failed, using stored runs:", err);
        }
      }
    }

    const runs = await getEventRuns(eventCode, season);
    if (runs.length === 0) {
      return NextResponse.json(
        { error: "No runs available for this event — live fetch failed and nothing is stored. Try the Setup page." },
        { status: 404 }
      );
    }

    const report = buildTechNoShowReport(cards, runs);
    return NextResponse.json({ ...report, source, liveError });
  } catch (error) {
    console.error("Tech no-show report error:", error);
    const message = error instanceof Error ? error.message : "Failed to build report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
