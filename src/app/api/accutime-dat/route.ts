import { NextRequest, NextResponse } from "next/server";
import { parseAccutimeDat } from "@/lib/accutime-dat";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

/**
 * POST /api/accutime-dat — multipart form with a `file` field holding an
 * AccuTime race.dat (Jet/Access database). Returns { runs: AccutimeRun[] }.
 * Parsing happens server-side because mdb-reader needs Node's Buffer; nothing
 * is stored — the client feeds the rows straight into the CompuLink exporters.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const runs = parseAccutimeDat(buffer);
    return NextResponse.json({ runs }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("AccuTime .dat parse failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read the .dat file" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
