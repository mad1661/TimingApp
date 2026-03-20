import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const eventKey = req.nextUrl.searchParams.get("event_key");
  if (!eventKey) {
    return NextResponse.json({ error: "event_key required" }, { status: 400 });
  }

  const date = req.nextUrl.searchParams.get("date");

  try {
    const db = getDb();

    if (date) {
      const docId = `${eventKey}_${date}`;
      const doc = await db.collection("schedule_plans").doc(docId).get();
      if (doc.exists) {
        return NextResponse.json({ plan: doc.data() });
      }
      // Fallback: check legacy doc (saved without date suffix)
      const legacyDoc = await db.collection("schedule_plans").doc(eventKey).get();
      if (legacyDoc.exists) {
        const data = legacyDoc.data()!;
        if (data.date === date && data.entries?.length > 0) {
          // Migrate legacy doc to new format
          await db.collection("schedule_plans").doc(docId).set(data);
          return NextResponse.json({ plan: data });
        }
      }
      return NextResponse.json({ plan: null });
    }

    const col = db.collection("schedule_plans");
    const allSnap = await col.get();
    const plans: FirebaseFirestore.DocumentData[] = [];
    for (const d of allSnap.docs) {
      const data = d.data();
      if (d.id === eventKey || d.id.startsWith(`${eventKey}_`) || data.eventKey === eventKey) {
        plans.push(data);
      }
    }
    return NextResponse.json({ plans });
  } catch (err) {
    console.error("Schedule plan GET error:", err);
    return NextResponse.json({ error: "Failed to load plan" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { event_key, startTime, entries, eventName, date, delayMinutes } = body;

    if (!event_key || !date) {
      return NextResponse.json({ error: "event_key and date required" }, { status: 400 });
    }

    const docId = `${event_key}_${date}`;
    const db = getDb();
    await db.collection("schedule_plans").doc(docId).set(
      {
        eventKey: event_key,
        eventName: eventName || "",
        date: date || "",
        startTime: startTime || "8:00 AM",
        delayMinutes: Math.max(0, Number(delayMinutes || 0)),
        entries: entries || [],
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Schedule plan POST error:", err);
    return NextResponse.json({ error: "Failed to save plan" }, { status: 500 });
  }
}
