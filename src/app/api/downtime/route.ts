import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

function eventKey(eventCode: string, season: string): string {
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
    const snap = await db
      .collection("events_data")
      .doc(eventKey(eventCode, season))
      .collection("downtime_entries")
      .orderBy("startTime", "asc")
      .get();

    const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("Downtime GET error:", err);
    return NextResponse.json({ error: "Failed to load downtime" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { event_code, season, reason, reasonLabel, startTime, endTime, date } = body;

    if (!event_code || !season || !reason || !startTime || !endTime) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const durationMin = Math.round(
      (new Date(`2000-01-01T${endTime}`).getTime() - new Date(`2000-01-01T${startTime}`).getTime()) / 60000
    );

    const db = getDb();
    const ref = await db
      .collection("events_data")
      .doc(eventKey(event_code, season))
      .collection("downtime_entries")
      .add({
        reason,
        reasonLabel: reasonLabel || reason,
        startTime,
        endTime,
        date: date || "",
        durationMin: Math.max(durationMin, 0),
        createdAt: new Date().toISOString(),
      });

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err) {
    console.error("Downtime POST error:", err);
    return NextResponse.json({ error: "Failed to save downtime" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const eventCode = req.nextUrl.searchParams.get("event_code");
  const season = req.nextUrl.searchParams.get("season");
  const id = req.nextUrl.searchParams.get("id");

  if (!eventCode || !season || !id) {
    return NextResponse.json({ error: "event_code, season, and id required" }, { status: 400 });
  }

  try {
    const db = getDb();
    await db
      .collection("events_data")
      .doc(eventKey(eventCode, season))
      .collection("downtime_entries")
      .doc(id)
      .delete();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Downtime DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete downtime" }, { status: 500 });
  }
}
