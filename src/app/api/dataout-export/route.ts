import { NextRequest, NextResponse } from "next/server";
import { getAllTechCards, getTaggedRunsForEvent } from "@/lib/db";
import type { EdataTechCard } from "@/lib/edata-export";
import { buildDataOutArtifacts } from "@/lib/dataout-export";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

interface DataOutRequest {
  event_code?: string;
  season?: string;
  event_name?: string;
  series_header?: string;
  logos?: { left?: unknown; center?: unknown; right?: unknown };
  /** Only these classes (exact category names) — class numbers stay event-wide. */
  categories?: unknown;
  /** Build the PDFs too. Off for the quick class-list load. */
  pdfs?: boolean;
  brand?: string;
}

/**
 * POST /api/dataout-export
 * { event_code, season, event_name?, series_header?, logos?, categories?, pdfs?, brand? }
 *
 * Builds the Compulink package from the event's STORED runs: EDAT
 * elimination files and QDAT qualifying files (one per class, one class
 * number for both), plus — with `pdfs` on — the StarTrak qualifying PDF and
 * the Final Round Results PDF, the same sheets the AccuTime export renders.
 * Entry-record fields merge from the tech cards. Returns JSON:
 * { edat: [...], qdat: [...], finalsPdfBase64, qualifyingPdfBase64, warnings }.
 * The client turns these into downloads / a RACEDATA.zip.
 *
 * POST rather than GET because the header logos ride along as data URLs.
 */
export async function POST(request: NextRequest) {
  try {
    let body: DataOutRequest = {};
    try {
      body = (await request.json()) as DataOutRequest;
    } catch {
      return NextResponse.json({ error: "Expected a JSON body" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const eventCode = (body.event_code || "").trim();
    const season = (body.season || "").trim();

    if (!eventCode || !season) {
      return NextResponse.json(
        { error: "event_code and season are required" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    // Header logos: PNG/JPEG data URLs the client rasterized. A bad value
    // can't break the PDFs, and a skipped logo is reported rather than
    // dropped silently.
    const logoWarnings: string[] = [];
    const logo = (v: unknown, label: string): string | undefined => {
      if (v === undefined || v === null || v === "") return undefined;
      if (typeof v !== "string" || !/^data:image\/(png|jpe?g);base64,/.test(v)) {
        logoWarnings.push(`${label} header logo isn't a PNG/JPEG image — the PDFs print without it.`);
        return undefined;
      }
      if (v.length > 3_000_000) {
        logoWarnings.push(`${label} header logo is too large — the PDFs print without it. Re-add it with a smaller image.`);
        return undefined;
      }
      return v;
    };
    const logos = {
      left: logo(body.logos?.left, "Left"),
      center: logo(body.logos?.center, "Event"),
      right: logo(body.logos?.right, "Right"),
    };

    const categories = Array.isArray(body.categories)
      ? body.categories.filter((c): c is string => typeof c === "string" && c.trim() !== "")
      : undefined;

    const [runs, techCards] = await Promise.all([
      getTaggedRunsForEvent(eventCode, season),
      // Tech cards only enrich; an export with blank entry fields still beats
      // no export if the collection can't be read.
      getAllTechCards().catch((err) => {
        console.error("Data Out export: tech cards unavailable:", err);
        return [];
      }),
    ]);

    const artifacts = buildDataOutArtifacts(runs, techCards as unknown as EdataTechCard[], {
      eventName: body.event_name || "",
      seriesHeader: body.series_header || "",
      logos,
      categories,
      pdfs: body.pdfs !== false,
      brand: typeof body.brand === "string" ? body.brand : undefined,
    });

    const toB64 = (bytes: Uint8Array | null) => (bytes ? Buffer.from(bytes).toString("base64") : null);

    return NextResponse.json(
      {
        edat: artifacts.edat,
        qdat: artifacts.qdat.map((f) => ({
          filename: f.filename,
          category: f.category,
          classCode: f.classCode,
          rounds: f.rounds,
          entries: f.entries,
          positioned: f.positioned,
          enriched: f.enriched,
          hasIndex: f.hasIndex,
          content: f.content,
        })),
        finalsPdfBase64: toB64(artifacts.finalsPdf),
        qualifyingPdfBase64: toB64(artifacts.qualifyingPdf),
        warnings: [...artifacts.warnings, ...logoWarnings],
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("Data Out export failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
