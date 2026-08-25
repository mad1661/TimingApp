import { NextRequest, NextResponse } from "next/server";
import { getEtFinalsConfig, saveEtFinalsConfig } from "@/lib/db";
import type { EtFinalsConfig } from "@/lib/et-finals";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const eventCode = params.get("event_code");
  const season = params.get("season");
  if (!eventCode || !season) {
    return NextResponse.json({ error: "event_code and season are required" }, { status: 400 });
  }
  const config = await getEtFinalsConfig(eventCode, season);
  return NextResponse.json({ config }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      event_code?: string;
      season?: string;
      config?: EtFinalsConfig;
    };
    if (!body.event_code || !body.season || !body.config) {
      return NextResponse.json({ error: "event_code, season and config are required" }, { status: 400 });
    }
    await saveEtFinalsConfig(body.event_code, body.season, body.config);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("ET Finals config save error:", err);
    return NextResponse.json({ error: "Failed to save config" }, { status: 500 });
  }
}
