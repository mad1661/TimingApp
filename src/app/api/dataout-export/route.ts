import { NextRequest, NextResponse } from "next/server";
import { getAllTechCards, getQualifyingConfig, getTaggedRunsForEvent } from "@/lib/db";
import { qualRuleFromMode, type EdataTechCard, type QualRule, type TimingSystem } from "@/lib/edata-export";
import { buildDataOutArtifacts } from "@/lib/dataout-export";
import { PRO_EVENT_SCALES, type ProEventScale } from "@/lib/accutime-points";

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
  /** C# the user pinned per class (category → number) — the tower's slot for a class it numbers its own way. */
  class_numbers?: unknown;
  /** The tower's event number in the points filenames (C10A11DP.TXT); points files are built only with one. */
  points_race_code?: string;
  pro_scale?: string;
  incomplete_race?: boolean;
  /** Tower dialect: "compulink" / "portatree", or omitted to read it off the stored rows. */
  timing?: string;
}

/**
 * POST /api/dataout-export
 * { event_code, season, event_name?, series_header?, logos?, categories?, pdfs?, brand?,
 *   class_numbers?, points_race_code?, pro_scale?, incomplete_race?, timing? }
 *
 * Builds the tower's RACEDATA package from the event's STORED runs: EDAT
 * elimination files and QDAT qualifying files (one per class, one class
 * number for both), CxAyyDP points files when a points race code is given,
 * plus — with `pdfs` on — the StarTrak qualifying PDF and the Final Round
 * Results PDF, the same sheets the AccuTime export renders. Passes from
 * outside the event's dates or another race filed under it are left out
 * (nothing is moved). Entry-record fields merge from the tech cards. Returns
 * JSON: { edat, qdat, points, timing, finalsPdfBase64, qualifyingPdfBase64,
 * warnings }. The client turns these into downloads / a RACEDATA.zip.
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

    const [runs, techCards, qualConfig] = await Promise.all([
      getTaggedRunsForEvent(eventCode, season),
      // Tech cards only enrich; an export with blank entry fields still beats
      // no export if the collection can't be read.
      getAllTechCards().catch((err) => {
        console.error("Data Out export: tech cards unavailable:", err);
        return [];
      }),
      // The event's own qualifying setup (per-class mode from /qualifying)
      // ranks the sheet when getresults never filled in a Q Pos.
      getQualifyingConfig(eventCode, season),
    ]);

    const qualRules: Record<string, QualRule> = {};
    for (const [category, mode] of Object.entries(qualConfig.classMode || {})) {
      const rule = qualRuleFromMode(mode);
      if (rule) qualRules[category.trim().toUpperCase().replace(/\s+/g, " ")] = rule;
    }

    const classNumbers: Record<string, number> = {};
    if (body.class_numbers && typeof body.class_numbers === "object") {
      for (const [category, n] of Object.entries(body.class_numbers as Record<string, unknown>)) {
        const num = typeof n === "number" ? n : parseInt(String(n), 10);
        if (Number.isInteger(num) && num > 0 && num < 100) classNumbers[category] = num;
      }
    }
    const timing: TimingSystem | undefined =
      body.timing === "compulink" || body.timing === "portatree" ? body.timing : undefined;
    const proScale = PRO_EVENT_SCALES.find((s) => s.value === body.pro_scale)?.value as ProEventScale | undefined;

    const artifacts = buildDataOutArtifacts(runs, techCards as unknown as EdataTechCard[], {
      eventName: body.event_name || "",
      seriesHeader: body.series_header || "",
      logos,
      categories,
      pdfs: body.pdfs !== false,
      brand: typeof body.brand === "string" ? body.brand : undefined,
      qualRules,
      timing,
      classNumbers,
      pointsRaceCode: typeof body.points_race_code === "string" ? body.points_race_code : "",
      proScale,
      incompleteRace: body.incomplete_race === true,
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
          rule: f.rule,
          computedOrder: f.computedOrder,
          enriched: f.enriched,
          hasIndex: f.hasIndex,
          content: f.content,
        })),
        points: artifacts.points.map((f) => ({
          filename: f.filename,
          category: f.category,
          classCode: f.classCode,
          fieldSize: f.fieldSize,
          rows: f.rows.length,
          notes: f.notes,
          content: f.content,
        })),
        timing: artifacts.timing,
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
