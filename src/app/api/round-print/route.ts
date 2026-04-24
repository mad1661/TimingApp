import { NextRequest, NextResponse } from "next/server";
import { getEventRuns, type RunRow } from "@/lib/db";
import { buildTimestampGroups, parseTsToDate } from "@/lib/timestamp-utils";

export interface RoundPrintRun {
  car_number: string | null;
  name: string | null;
  category: string | null;
  class_index: string | null;
  dial_in: number | null;
  lane: string | null;
  rt: number | null;
  ft60: number | null;
  ft330: number | null;
  ft660: number | null;
  mph_660: number | null;
  ft1000: number | null;
  mph_1000: number | null;
  ft1320: number | null;
  mph_1320: number | null;
  mov: number | null;
  is_winner: number;
  is_dq: number;
  result: string | null;
  timestamp: string | null;
  run_number: number;
  index_value: number | null;
  over_under_thou: number | null;
  remarks: string;
}

export interface RoundPrintPair {
  canonical_ts: string;
  time_label: string;
  runs: RoundPrintRun[];
  pair_mov: number | null;
  winner_car: string | null;
}

export interface RoundPrintPayload {
  event_code: string;
  season: string;
  round: string;
  category: string | null;
  class_filter: string | null;
  round_header: string;
  start_time_label: string;
  end_time_label: string;
  date_label: string;
  car_count: number;
  pair_count: number;
  pairs: RoundPrintPair[];
}

function laneOrder(lane: string | null): number {
  const l = (lane || "").toUpperCase();
  if (l === "L" || l === "1") return 1;
  if (l === "R" || l === "2") return 2;
  if (l === "3") return 3;
  if (l === "4") return 4;
  return 99;
}

function fmtClock(date: Date | null): string {
  if (!date) return "";
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function fmtDate(date: Date | null): string {
  if (!date) return "";
  const d = date.getDate().toString().padStart(2, "0");
  const m = MONTHS[date.getMonth()];
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function parseIndex(classIndex: string | null, dialIn: number | null): number | null {
  if (dialIn != null && dialIn > 0) return dialIn;
  if (!classIndex) return null;
  const m = classIndex.match(/(\d+\.\d+)/);
  if (m) {
    const v = parseFloat(m[1]);
    if (!isNaN(v)) return v;
  }
  return null;
}

function computeRemarks(r: RunRow): string {
  const parts: string[] = [];
  if (r.is_dq) parts.push("DQ");
  if (r.rt != null && r.rt < 0) parts.push("RED");
  return parts.join(" ");
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const eventCode = params.get("event_code") || "";
    const season = params.get("season") || "";
    const round = params.get("round") || "";
    const category = params.get("category");
    const classFilter = params.get("class_index");

    if (!eventCode || !season || !round) {
      return NextResponse.json({ error: "event_code, season, and round are required" }, { status: 400 });
    }

    const allRuns = await getEventRuns(eventCode, season);

    // Assign event-wide sequential run numbers by chronological order.
    const sortedByTime = [...allRuns].sort((a, b) => {
      const da = a.timestamp ? parseTsToDate(a.timestamp) : null;
      const db = b.timestamp ? parseTsToDate(b.timestamp) : null;
      const ta = da ? da.getTime() : 0;
      const tb = db ? db.getTime() : 0;
      if (ta !== tb) return ta - tb;
      return laneOrder(a.lane) - laneOrder(b.lane);
    });
    const runNumberMap = new Map<RunRow, number>();
    sortedByTime.forEach((r, i) => runNumberMap.set(r, i + 1));

    // Filter to the requested round/category/class.
    const filtered = allRuns.filter((r) => {
      if (r.round !== round) return false;
      if (category && r.category !== category) return false;
      if (classFilter && (r.class_index || "").trim() !== classFilter) return false;
      return true;
    });

    if (filtered.length === 0) {
      return NextResponse.json({
        event_code: eventCode,
        season,
        round,
        category,
        class_filter: classFilter,
        round_header: `Round # ${round}`,
        start_time_label: "",
        end_time_label: "",
        date_label: "",
        car_count: 0,
        pair_count: 0,
        pairs: [],
      } satisfies RoundPrintPayload);
    }

    // Group runs into pairs by canonical timestamp.
    const allTs = filtered.map((r) => r.timestamp).filter(Boolean) as string[];
    const tsGroups = buildTimestampGroups(allTs);

    const pairMap = new Map<string, RunRow[]>();
    for (const run of filtered) {
      if (!run.timestamp) continue;
      const canonical = tsGroups.get(run.timestamp) || run.timestamp;
      const arr = pairMap.get(canonical) || [];
      arr.push(run);
      pairMap.set(canonical, arr);
    }

    const pairs: RoundPrintPair[] = [];
    for (const [canonical, runs] of pairMap) {
      runs.sort((a, b) => laneOrder(a.lane) - laneOrder(b.lane));
      const firstRun = runs[0];
      const date = parseTsToDate(canonical);
      const timeLabel = fmtClock(date);

      // Pair-level MOV: use the recorded mov from whichever run has it, or compute
      // from winning/losing ET if both are available.
      let pairMov: number | null = null;
      const withMov = runs.find((r) => r.mov != null);
      if (withMov && withMov.mov != null) {
        pairMov = withMov.mov;
      }
      const winner = runs.find((r) => {
        const res = (r.result || "").trim().toUpperCase();
        return res === "W" || (!res && r.is_winner === 1);
      });

      pairs.push({
        canonical_ts: canonical,
        time_label: timeLabel,
        pair_mov: pairMov,
        winner_car: winner?.car_number ?? null,
        runs: runs.map((r) => {
          const index_value = parseIndex(r.class_index, r.dial_in);
          let over_under_thou: number | null = null;
          if (index_value != null && r.ft1320 != null) {
            over_under_thou = Math.round((r.ft1320 - index_value) * 1000);
          }
          return {
            car_number: r.car_number,
            name: r.name,
            category: r.category,
            class_index: r.class_index,
            dial_in: r.dial_in,
            lane: r.lane,
            rt: r.rt,
            ft60: r.ft60,
            ft330: r.ft330,
            ft660: r.ft660,
            mph_660: r.mph_660,
            ft1000: r.ft1000,
            mph_1000: r.mph_1000,
            ft1320: r.ft1320,
            mph_1320: r.mph_1320,
            mov: r.mov,
            is_winner: r.is_winner,
            is_dq: r.is_dq,
            result: r.result ?? null,
            timestamp: r.timestamp,
            run_number: runNumberMap.get(r) ?? 0,
            index_value,
            over_under_thou,
            remarks: computeRemarks(r),
          } satisfies RoundPrintRun;
        }),
      });
      // Ignore unused destructure value
      void firstRun;
    }

    pairs.sort((a, b) => {
      const da = parseTsToDate(a.canonical_ts);
      const db = parseTsToDate(b.canonical_ts);
      const ta = da ? da.getTime() : 0;
      const tb = db ? db.getTime() : 0;
      return ta - tb;
    });

    const firstTs = pairs[0]?.canonical_ts ?? null;
    const lastTs = pairs[pairs.length - 1]?.canonical_ts ?? null;
    const firstDate = firstTs ? parseTsToDate(firstTs) : null;
    const lastDate = lastTs ? parseTsToDate(lastTs) : null;

    const payload: RoundPrintPayload = {
      event_code: eventCode,
      season,
      round,
      category: category ?? null,
      class_filter: classFilter ?? null,
      round_header: `Round # ${round}`,
      start_time_label: fmtClock(firstDate),
      end_time_label: fmtClock(lastDate),
      date_label: fmtDate(firstDate),
      car_count: filtered.length,
      pair_count: pairs.length,
      pairs,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("round-print error:", error);
    return NextResponse.json({ error: "Failed to build round print" }, { status: 500 });
  }
}
