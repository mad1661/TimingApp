import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

function docId(eventCode: string, season: string): string {
  return `${eventCode}_${season}`;
}

export async function GET(req: NextRequest) {
  const eventCode = req.nextUrl.searchParams.get("event_code");
  const season = req.nextUrl.searchParams.get("season");
  if (!eventCode || !season) {
    return NextResponse.json({ error: "event_code and season required" }, { status: 400 });
  }

  try {
    const db = getDb();
    const doc = await db.collection("ignored_runs").doc(docId(eventCode, season)).get();
    const keys: string[] = doc.exists ? doc.data()?.keys || [] : [];
    return NextResponse.json({ keys });
  } catch (err) {
    console.error("Ignored runs GET error:", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { event_code, season, dedup_key, action } = await req.json();
    if (!event_code || !season || !dedup_key) {
      return NextResponse.json({ error: "event_code, season, and dedup_key required" }, { status: 400 });
    }

    const db = getDb();
    const ref = db.collection("ignored_runs").doc(docId(event_code, season));
    const doc = await ref.get();
    let keys: string[] = doc.exists ? doc.data()?.keys || [] : [];

    if (action === "restore") {
      keys = keys.filter((k) => k !== dedup_key);
    } else {
      if (!keys.includes(dedup_key)) keys.push(dedup_key);
    }

    await ref.set({ keys, updatedAt: new Date().toISOString() }, { merge: true });
    return NextResponse.json({ ok: true, keys });
  } catch (err) {
    console.error("Ignored runs POST error:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
