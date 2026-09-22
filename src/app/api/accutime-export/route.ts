import { NextRequest, NextResponse } from "next/server";
import { getAllTechCards } from "@/lib/db";
import type { EdataTechCard } from "@/lib/edata-export";
import { parseAccuTimePack } from "@/lib/accutime";
import { buildAccuTimeArtifacts } from "@/lib/accutime-export";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * POST /api/accutime-export  (multipart: files[], event_name?)
 *
 * Parses AccuTime session files (.acc / .dat / .qly / Class.ini / Drivers.dbf),
 * merges the shared tech_cards store, and returns the Compulink export package
 * as JSON: QDAT + EDAT text files plus base64 finals / qualifying PDFs. The
 * client saves them individually or as a RACEDATA.zip.
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    const eventName = (form.get("event_name") as string) || "";
    const eventCode = (form.get("event_code") as string) || "";
    const season = (form.get("season") as string) || "";

    if (files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const packFiles = await Promise.all(
      files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })),
    );

    const { sessions, warnings: parseWarnings } = parseAccuTimePack(packFiles, {
      eventCode,
      eventName,
      season,
    });

    // Merge in the shared tech-card store (every-card read, v1.40.1).
    let storedCards: EdataTechCard[] = [];
    try {
      storedCards = (await getAllTechCards()) as unknown as EdataTechCard[];
    } catch (err) {
      console.error("AccuTime export: tech cards unavailable:", err);
    }

    const artifacts = buildAccuTimeArtifacts(sessions, storedCards, { eventName });

    const toB64 = (bytes: Uint8Array | null) =>
      bytes ? Buffer.from(bytes).toString("base64") : null;

    return NextResponse.json(
      {
        sessions: sessions.map((s) => ({
          classCode: s.classCode,
          className: s.className,
          raceDate: s.raceDate,
          qualifiers: s.qualifying.length,
          qualSessions: s.qualSessions,
          elimRounds: s.elimRounds.map((r) => r.round),
          drivers: s.drivers.length,
          treeBase: s.treeBase,
          warnings: s.warnings,
        })),
        edat: artifacts.edat.map((f) => ({
          filename: f.filename,
          category: f.category,
          rounds: f.rounds,
          pairs: f.pairs,
          runs: f.runs,
          enriched: f.enriched,
          content: f.content,
        })),
        qdat: artifacts.qdat,
        finalsPdfBase64: toB64(artifacts.finalsPdf),
        qualifyingPdfBase64: toB64(artifacts.qualifyingPdf),
        coverage: artifacts.coverage,
        warnings: [...parseWarnings, ...artifacts.warnings],
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("AccuTime export failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
