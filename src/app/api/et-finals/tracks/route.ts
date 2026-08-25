import { NextRequest, NextResponse } from "next/server";
import {
  getEtFinalsTrackCodes,
  getEtFinalsTrackNames,
  saveEtFinalsTrackNames,
  type EtTrackName,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const season = request.nextUrl.searchParams.get("season");
  if (!season) return NextResponse.json({ error: "season is required" }, { status: 400 });
  try {
    const [tracks, codes] = await Promise.all([
      getEtFinalsTrackNames(season),
      getEtFinalsTrackCodes(season),
    ]);
    return NextResponse.json({ tracks, codes }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    console.error("ET Finals track name load error:", err);
    return NextResponse.json({ error: "Failed to load track names" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      season?: string;
      tracks?: Record<string, EtTrackName>;
    };
    if (!body.season || !body.tracks) {
      return NextResponse.json({ error: "season and tracks are required" }, { status: 400 });
    }
    await saveEtFinalsTrackNames(body.season, body.tracks);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("ET Finals track name save error:", err);
    return NextResponse.json({ error: "Failed to save track names" }, { status: 500 });
  }
}
