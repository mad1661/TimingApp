import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { normalizeDedupKey } from "@/lib/db";

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
    const raw: string[] = doc.exists ? doc.data()?.keys || [] : [];
    // Stored keys may predate the current dedup-key shape; normalize so the
    // client's comparisons against live _dedup_key values match.
    const keys = [...new Set(raw.map(normalizeDedupKey))];
    return NextResponse.json({ keys });
  } catch (err) {
    console.error("Ignored runs GET error:", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { event_code, season, dedup_key, dedup_keys, action } = await req.json();
    if (!event_code || !season || (!dedup_key && !Array.isArray(dedup_keys))) {
      return NextResponse.json(
        { error: "event_code, season, and dedup_key (or dedup_keys) required" },
        { status: 400 },
      );
    }

    const db = getDb();
    const ref = db.collection("ignored_runs").doc(docId(event_code, season));
    const doc = await ref.get();
    const raw: string[] = doc.exists ? doc.data()?.keys || [] : [];
    // Normalize both the stored list and the incoming key so add/restore work
    // against keys saved under the older dedup-key shape.
    let keys = [...new Set(raw.map(normalizeDedupKey))];

    // Bulk form: lock out (or restore) many passes at once — used by "lock out
    // everything run so far", which excludes the runs already on file so only
    // later passes count.
    if (Array.isArray(dedup_keys)) {
      const incoming = dedup_keys
        .filter((k: unknown): k is string => typeof k === "string" && k.length > 0)
        .map(normalizeDedupKey);
      if (action === "restore") {
        const drop = new Set(incoming);
        keys = keys.filter((k) => !drop.has(k));
      } else {
        keys = [...new Set([...keys, ...incoming])];
      }
      await ref.set({ keys, updatedAt: new Date().toISOString() });
      return NextResponse.json({ ok: true, count: keys.length });
    }

    const key = normalizeDedupKey(dedup_key);
    if (action === "restore") {
      keys = keys.filter((k) => k !== key);
    } else {
      if (!keys.includes(key)) keys.push(key);
    }

    await ref.set({ keys, updatedAt: new Date().toISOString() });
    return NextResponse.json({ ok: true, keys });
  } catch (err) {
    console.error("Ignored runs POST error:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
