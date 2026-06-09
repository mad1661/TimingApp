import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { getEventRuns, upsertRun, type RunRow } from "@/lib/db";

export const dynamic = "force-dynamic";

function ignoreDocId(eventCode: string, season: string): string {
  return `${eventCode}_${season}`;
}

async function addIgnoredKey(eventCode: string, season: string, key: string) {
  const db = getDb();
  const ref = db.collection("ignored_runs").doc(ignoreDocId(eventCode, season));
  const doc = await ref.get();
  const keys: string[] = doc.exists ? doc.data()?.keys || [] : [];
  if (!keys.includes(key)) keys.push(key);
  await ref.set({ keys, updatedAt: new Date().toISOString() }, { merge: true });
}

const NUMERIC_FIELDS = new Set([
  "rt", "ft60", "ft330", "ft660", "mph_660", "ft1000", "mph_1000",
  "ft1320", "mph_1320", "mov", "is_winner", "is_dq", "qual_pos", "dial_in",
  "manual_run_number",
]);

const STRING_FIELDS = new Set([
  "timestamp", "round", "car_number", "name", "class_index",
  "result", "place", "category", "lane",
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { event_code, season, dedup_key, updates } = body as {
      event_code: string;
      season: string;
      dedup_key: string;
      updates: Record<string, unknown>;
    };

    if (!event_code || !season || !dedup_key || !updates) {
      return NextResponse.json({ error: "event_code, season, dedup_key and updates required" }, { status: 400 });
    }

    const allRuns = await getEventRuns(event_code, season);
    const original = allRuns.find((r) => r._dedup_key === dedup_key);
    if (!original) {
      return NextResponse.json({ error: "Run not found for dedup_key" }, { status: 404 });
    }

    const merged: RunRow = { ...original };
    const asRecord = merged as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(updates)) {
      if (NUMERIC_FIELDS.has(k)) {
        if (v === null || v === "") asRecord[k] = null;
        else asRecord[k] = typeof v === "number" ? v : parseFloat(String(v));
      } else if (STRING_FIELDS.has(k)) {
        asRecord[k] = v === null || v === "" ? null : String(v);
      }
    }

    // If car_number / name / class_index change, try to auto-propagate canonical
    // info from other runs in the same event (matching new car_number + category).
    if (typeof updates.car_number !== "undefined" && merged.car_number && merged.category) {
      const match = allRuns.find(
        (r) =>
          r.car_number?.trim() === merged.car_number?.trim() &&
          r.category === merged.category &&
          r.name
      );
      if (match) {
        if (!("name" in updates)) merged.name = match.name;
        if (!("class_index" in updates)) merged.class_index = match.class_index;
      }
    }

    // Preserve immutable event metadata.
    merged.event_code = original.event_code;
    merged.season = original.season;
    merged.event_type = original.event_type;
    merged.event_name = original.event_name;
    merged.start_date = original.start_date;

    const keyFieldChanged =
      merged.timestamp !== original.timestamp ||
      merged.car_number !== original.car_number ||
      merged.round !== original.round ||
      merged.lane !== original.lane;

    if (keyFieldChanged) {
      await addIgnoredKey(event_code, season, dedup_key);
    }

    // Strip internal fields before upsert.
    const toInsert: Omit<RunRow, "id" | "created_at" | "_dedup_key"> = {
      timestamp: merged.timestamp,
      round: merged.round,
      qual_pos: merged.qual_pos,
      car_number: merged.car_number,
      name: merged.name,
      class_index: merged.class_index,
      rt: merged.rt,
      ft60: merged.ft60,
      ft330: merged.ft330,
      ft660: merged.ft660,
      mph_660: merged.mph_660,
      ft1000: merged.ft1000,
      mph_1000: merged.mph_1000,
      ft1320: merged.ft1320,
      mph_1320: merged.mph_1320,
      mov: merged.mov,
      is_winner: merged.is_winner,
      is_dq: merged.is_dq,
      result: merged.result,
      place: merged.place,
      category: merged.category,
      lane: merged.lane,
      dial_in: merged.dial_in,
      event_code: merged.event_code,
      event_name: merged.event_name,
      event_type: merged.event_type,
      season: merged.season,
      start_date: merged.start_date,
      manual_run_number: merged.manual_run_number ?? null,
      manual_entry: merged.manual_entry ?? null,
      // Keep the row's position in the chronological day-walk — without this an
      // edited run re-sorts at seq 0 and can flip the whole day's AM/PM walk.
      // (Spread conditionally: an explicit `undefined` would fail the Firestore
      // write, since ignoreUndefinedProperties isn't enabled.)
      ...(original._scrape_seq != null ? { _scrape_seq: original._scrape_seq } : {}),
      // The exact-timestamp marker survives an edit unless the user changed the
      // timestamp itself; then it's exact only if they typed an AM/PM marker.
      _ts_exact:
        merged.timestamp === original.timestamp
          ? original._ts_exact ?? false
          : /\s(AM|PM)\s*$/i.test(merged.timestamp || ""),
    };

    await upsertRun(event_code, season, toInsert);

    return NextResponse.json({ ok: true, replaced: keyFieldChanged });
  } catch (err) {
    console.error("edit-run error:", err);
    return NextResponse.json({ error: "Failed to edit run" }, { status: 500 });
  }
}
