import { NextRequest, NextResponse } from "next/server";
import { getElimRunsForEvent } from "@/lib/db";
import { buildEdataExport } from "@/lib/edata-export";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

/**
 * GET /api/edata-export?event_code=…&season=…
 *
 * Builds CompuLink StarTrak EDAT elimination files (one per class) from the
 * event's stored runs and returns them as JSON: { files: [{ filename,
 * category, classCode, rounds, pairs, runs, content }], warnings }. The
 * client turns these into downloads / a RACEDATA.zip.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const eventCode = (params.get("event_code") || "").trim();
    const season = (params.get("season") || "").trim();

    if (!eventCode || !season) {
      return NextResponse.json(
        { error: "event_code and season are required" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const runs = await getElimRunsForEvent(eventCode, season);
    const result = buildEdataExport(runs);
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("EData export failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
