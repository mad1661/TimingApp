import { NextRequest, NextResponse } from "next/server";
import { deleteEtFinalsSetup, listEtFinalsSetups, saveEtFinalsSetup } from "@/lib/db";
import type { EtFinalsConfig } from "@/lib/et-finals";

export const dynamic = "force-dynamic";

export async function GET() {
  const setups = await listEtFinalsSetups();
  return NextResponse.json({ setups }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      name?: string;
      season?: string;
      event_code?: string;
      config?: EtFinalsConfig;
    };
    if (!body.name?.trim() || !body.config) {
      return NextResponse.json({ error: "name and config are required" }, { status: 400 });
    }
    const id = await saveEtFinalsSetup(
      body.name,
      body.season || "",
      body.event_code || "",
      body.config,
    );
    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error("ET Finals setup save error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save settings" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    await deleteEtFinalsSetup(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("ET Finals setup delete error:", err);
    return NextResponse.json({ error: "Failed to delete settings" }, { status: 500 });
  }
}
