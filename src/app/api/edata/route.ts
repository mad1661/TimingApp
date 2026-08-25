import { NextRequest, NextResponse } from "next/server";
import { insertRuns, insertEvent, invalidateEventCache, logFetch } from "@/lib/db";
import { parseEdataFile } from "@/lib/edata-parse";

// EData is uploaded, not fetched, but the same rule applies as for the scraping
// routes: never let Next cache a results response, or the page keeps showing
// the round before last.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);
    const eventCode = ((formData.get("event_code") as string) || "").trim();
    const season = ((formData.get("season") as string) || "").trim();

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }
    if (!eventCode || !season) {
      return NextResponse.json({ error: "event_code and season are required" }, { status: 400 });
    }

    const eventName = ((formData.get("event_name") as string) || "").trim();
    const eventType = ((formData.get("event_type") as string) || "").trim();
    const raceDate = ((formData.get("race_date") as string) || "").trim();
    const categoryOverride = ((formData.get("category") as string) || "").trim();

    // Drop any cached copy before writing, so the read that follows this upload
    // sees the new rounds rather than a stale per-instance snapshot.
    invalidateEventCache(eventCode, season);

    if (eventName) {
      await insertEvent({
        event_code: eventCode,
        event_type: eventType || "D",
        event_name: eventName,
        season,
        start_date: raceDate || "",
      });
    }

    const perFile: {
      name: string;
      category: string;
      rounds: string[];
      parsed: number;
      inserted: number;
      warnings: string[];
      error?: string;
    }[] = [];
    let totalParsed = 0;
    let totalInserted = 0;

    for (const file of files) {
      try {
        // EData is DOS-era ASCII; latin1 round-trips every byte, where utf-8
        // would mangle the occasional high-bit character in a name.
        const raw = Buffer.from(await file.arrayBuffer()).toString("latin1");
        const result = parseEdataFile(raw, {
          eventCode,
          season,
          eventName: eventName || undefined,
          eventType: eventType || undefined,
          raceDate: raceDate || undefined,
          // An override only makes sense for a single file; several files are
          // several classes.
          category: files.length === 1 ? categoryOverride || undefined : undefined,
          fileName: file.name,
        });

        let inserted = 0;
        if (result.runs.length > 0) {
          inserted = await insertRuns(eventCode, season, result.runs);
        }
        totalParsed += result.runs.length;
        totalInserted += inserted;
        perFile.push({
          name: file.name,
          category: result.category,
          rounds: result.rounds,
          parsed: result.runs.length,
          inserted,
          warnings: result.warnings,
        });
      } catch (err) {
        console.error(`EData parse failed for ${file.name}:`, err);
        perFile.push({
          name: file.name,
          category: "",
          rounds: [],
          parsed: 0,
          inserted: 0,
          warnings: [],
          error: err instanceof Error ? err.message : "Failed to parse",
        });
      }
    }

    invalidateEventCache(eventCode, season);
    if (totalParsed > 0) {
      await logFetch(eventCode, season, eventType || "EDATA", totalParsed);
    }

    return NextResponse.json(
      { success: true, files: files.length, totalParsed, totalInserted, perFile },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err) {
    console.error("EData upload error:", err);
    return NextResponse.json({ error: "Failed to process EData files" }, { status: 500 });
  }
}
