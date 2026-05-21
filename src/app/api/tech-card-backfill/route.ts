import { NextRequest, NextResponse } from "next/server";
import { techCardViewerLogin, listTechCardEvents, scrapeTechCards } from "@/lib/techcardviewer-scraper";
import { racefilesLogin, listCompulinkEvents, downloadCompulinkExcel } from "@/lib/racefiles-compulink";
import { parseTechCardWorkbook } from "@/lib/tech-card-parse";
import { saveTechCards } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

// Browser-driven tech-card backfill. Two sources, same login:
//  - source "grid"  -> techcardviewer.nhradata.com /TCND1 HTML grid (fast,
//    partial fields).
//  - source "excel" -> racefiles.nhradata.com Create Compulink File, which
//    generates the full .xlsx per event (slow, complete fields).
// The client loops: mode "list" to enumerate events, then mode "events" to
// import a small batch at a time (keeping each request within the timeout).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, mode, source } = body;

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }

    if (source === "excel") {
      const eventType: string = body.eventType || "National and Divisional";
      const includeJr: boolean = body.includeJr !== false;
      const cookies = await racefilesLogin(username, password);

      if (mode === "list") {
        const events = await listCompulinkEvents(cookies, eventType);
        return NextResponse.json({ success: true, events }, { headers: NO_STORE_HEADERS });
      }
      if (mode === "events") {
        const events: string[] = Array.isArray(body.events) ? body.events : [];
        const results: { event: string; parsed?: number; saved?: number; error?: string }[] = [];
        for (const ev of events) {
          try {
            const buf = await downloadCompulinkExcel(cookies, eventType, ev, includeJr);
            const entries = parseTechCardWorkbook(buf, ev);
            const { saved } = await saveTechCards(entries);
            results.push({ event: ev, parsed: entries.length, saved });
          } catch (err) {
            results.push({ event: ev, error: err instanceof Error ? err.message : String(err) });
          }
        }
        return NextResponse.json({ success: true, results }, { headers: NO_STORE_HEADERS });
      }
      return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
    }

    // Default: Tech Card Viewer grid.
    const cookies = await techCardViewerLogin(username, password);

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
