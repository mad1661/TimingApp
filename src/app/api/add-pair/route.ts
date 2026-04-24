import { NextRequest, NextResponse } from "next/server";
import { insertRuns, getEventRuns, type RunRow } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { event_code, season, runs } = body as {
      event_code: string;
      season: string;
      runs: Array<Partial<RunRow>>;
    };

    if (!event_code || !season || !Array.isArray(runs) || runs.length === 0) {
      return NextResponse.json({ error: "event_code, season, and runs[] required" }, { status: 400 });
    }

    // Infer event_name / event_type / start_date from existing runs in this event.
    const existing = await getEventRuns(event_code, season);
    const template = existing[0];

    const normalized = runs.map((r) => ({
      timestamp: r.timestamp ?? null,
      round: r.round ?? null,
      qual_pos: r.qual_pos ?? null,
      car_number: r.car_number ?? null,
      name: r.name ?? null,
      class_index: r.class_index ?? null,
      rt: r.rt != null ? Number(r.rt) : null,
      ft60: r.ft60 != null ? Number(r.ft60) : null,
      ft330: r.ft330 != null ? Number(r.ft330) : null,
      ft660: r.ft660 != null ? Number(r.ft660) : null,
      mph_660: r.mph_660 != null ? Number(r.mph_660) : null,
      ft1000: r.ft1000 != null ? Number(r.ft1000) : null,
      mph_1000: r.mph_1000 != null ? Number(r.mph_1000) : null,
      ft1320: r.ft1320 != null ? Number(r.ft1320) : null,
      mph_1320: r.mph_1320 != null ? Number(r.mph_1320) : null,
      mov: r.mov != null ? Number(r.mov) : null,
      is_winner: r.is_winner ? 1 : 0,
      is_dq: r.is_dq ? 1 : 0,
      result: r.result ?? null,
      place: r.place ?? null,
      category: r.category ?? null,
      lane: r.lane ?? null,
      dial_in: r.dial_in != null ? Number(r.dial_in) : null,
      event_code,
      event_name: r.event_name ?? template?.event_name ?? null,
      event_type: r.event_type ?? template?.event_type ?? null,
      season,
      start_date: r.start_date ?? template?.start_date ?? null,
      manual_entry: 1,
    }));

    const count = await insertRuns(event_code, season, normalized);
    return NextResponse.json({ ok: true, inserted: count });
  } catch (err) {
    console.error("add-pair error:", err);
    return NextResponse.json({ error: "Failed to add pair" }, { status: 500 });
  }
}
