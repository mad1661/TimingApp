import { NextRequest, NextResponse } from "next/server";
import { deleteEtFinalsRoster, getEtFinalsRosters, saveEtFinalsRoster } from "@/lib/db";
import { parseEtFinalsRosterWorkbook } from "@/lib/et-finals-parse";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const season = request.nextUrl.searchParams.get("season") || undefined;
  try {
    const rosters = await getEtFinalsRosters(season);
    // Entries are dropped here — the list view only needs the counts, and a
    // full division's rosters is a lot of rows to ship for a summary.
    return NextResponse.json({
      rosters: rosters.map((r) => ({
        id: r.id,
        track_code: r.track_code,
        track_name: r.track_name,
        team_name: r.team_name,
        captain: r.captain,
        season: r.season,
        event_name: r.event_name,
        source_file: r.source_file,
        uploaded_at: r.uploaded_at,
        bigEntries: r.entries.filter((e) => e.division === "big").length,
        jrEntries: r.entries.filter((e) => e.division === "jr").length,
        jrPointsEntries: r.entries.filter((e) => e.division === "jr" && e.points_eligible).length,
      })),
    });
  } catch (err) {
    console.error("ET Finals roster list error:", err);
    return NextResponse.json({ error: "Failed to load rosters" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const roster = parseEtFinalsRosterWorkbook(buffer, {
      fileName: file.name,
      trackCode: (formData.get("track_code") as string) || undefined,
      teamName: (formData.get("team_name") as string) || undefined,
      season: (formData.get("season") as string) || undefined,
    });

    if (roster.entries.length === 0) {
      return NextResponse.json(
        { error: "No roster entries found — is this the combined ET Finals / JDRL template?" },
        { status: 400 },
      );
    }

    const id = await saveEtFinalsRoster(roster);
    return NextResponse.json({
      success: true,
      id,
      track_code: roster.track_code,
      team_name: roster.team_name,
      season: roster.season,
      bigEntries: roster.entries.filter((e) => e.division === "big").length,
      jrEntries: roster.entries.filter((e) => e.division === "jr").length,
      jrPointsEntries: roster.entries.filter((e) => e.division === "jr" && e.points_eligible).length,
    });
  } catch (err) {
    console.error("ET Finals roster upload error:", err);
    return NextResponse.json({ error: "Failed to process roster file" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    await deleteEtFinalsRoster(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("ET Finals roster delete error:", err);
    return NextResponse.json({ error: "Failed to delete roster" }, { status: 500 });
  }
}
