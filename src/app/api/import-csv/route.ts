import { NextRequest, NextResponse } from "next/server";
import { parseCsvToRuns } from "@/lib/csv-parser";
import { insertRuns, insertEvent, logFetch } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const eventCode = (formData.get("event_code") as string) || "IMPORT";
    const eventName = (formData.get("event_name") as string) || "CSV Import";
    const eventType = (formData.get("event_type") as string) || "N";
    const season = (formData.get("season") as string) || new Date().getFullYear().toString();
    const startDate = (formData.get("start_date") as string) || "";

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const csvText = await file.text();
    const runs = parseCsvToRuns(csvText, { event_code: eventCode, event_name: eventName, event_type: eventType, season, start_date: startDate });

    if (runs.length === 0) {
      return NextResponse.json({ error: "No valid runs found in CSV" }, { status: 400 });
    }

    await insertEvent({ event_code: eventCode, event_type: eventType, event_name: eventName, season, start_date: startDate });
    const inserted = await insertRuns(eventCode, season, runs);
    await logFetch(eventCode, season, eventType, inserted);

    return NextResponse.json({ success: true, totalParsed: runs.length, inserted });
  } catch (error) {
    console.error("CSV import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import CSV" },
      { status: 500 }
    );
  }
}
