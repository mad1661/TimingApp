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
  finish: number | null;
  winpos: string;
}

export interface RoundPrintPair {
  canonical_ts: string;
  time_label: string;
  runs: RoundPrintRun[];
  pair_mov: number | null;
  winner_car: string | null;
  has_manual_entry: boolean;
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
  is_four_wide: boolean;
  car_count: number;
  pair_count: number;
  pairs: RoundPrintPair[];
}

function laneOrder(lane: string | null): number {
  const l = (lane || "").toUpperCase();
  if (l === "L" || l === "L1" || l === "1") return 1;
  if (l === "R" || l === "L2" || l === "2") return 2;
  if (l === "L3" || l === "3") return 3;
  if (l === "L4" || l === "4") return 4;
  return 99;
}

function makeEmptyLaneRun(laneLabel: string, category: string | null): RoundPrintRun {
  return {
    car_number: null,
    name: null,
    category,
    class_index: null,
    dial_in: null,
    lane: laneLabel,
    rt: null,
    ft60: null,
    ft330: null,
    ft660: null,
    mph_660: null,
    ft1000: null,
    mph_1000: null,
    ft1320: null,
    mph_1320: null,
    mov: null,
    is_winner: 0,
    is_dq: 0,
    result: null,
    timestamp: null,
    run_number: 0,
    index_value: null,
    over_under_thou: 0,
    remarks: "",
    finish: 5,
    winpos: "DNF",
  };
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

function posLabel(pos: number): string {
  if (pos === 1) return "WIN";
  if (pos === 2) return "2nd";
  if (pos === 3) return "3rd";
  if (pos === 4) return "4th";
  return "";
}

function computeRemarks(r: RunRow): string {
  const parts: string[] = [];
  const didNotFinish = r.ft1320 == null || r.ft1320 === 0;
  if (r.is_dq) parts.push("DQ");
  else if (didNotFinish) parts.push("BROKE");
  if (r.rt != null && r.rt < 0) parts.push("RED");
  const res = (r.result || "").trim().toUpperCase();
  if (res === "W" || (!res && r.is_winner === 1)) parts.push("WIN");
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
        is_four_wide: false,
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
    let maxPairSize = 0;

    const hasAnyTiming = (r: RunRow): boolean =>
      r.rt != null || r.ft60 != null || r.ft330 != null ||
      r.ft660 != null || r.ft1000 != null || r.ft1320 != null;

    const dataScore = (r: RunRow): number => {
      let n = 0;
      if (r.rt != null) n++;
      if (r.ft60 != null) n++;
      if (r.ft330 != null) n++;
      if (r.ft660 != null) n++;
      if (r.ft1000 != null) n++;
      if (r.ft1320 != null) n++;
      if (r.mph_1320 != null) n++;
      return n;
    };

    for (const [canonical, rawRuns] of pairMap) {
      // Collapse consecutive timing-system resets: within one pair, if multiple
      // rows share the same lane + car number, keep the row with the most
      // recorded timing data and drop the others.
      const byLaneCar = new Map<string, RunRow>();
      for (const run of rawRuns) {
        const key = `${(run.lane || "").toUpperCase()}|${(run.car_number || "").trim()}`;
        const existing = byLaneCar.get(key);
        if (!existing || dataScore(run) > dataScore(existing)) {
          byLaneCar.set(key, run);
        }
      }
      const runs = Array.from(byLaneCar.values());

      // If nothing went down the track in this entire pair, skip it.
      if (!runs.some(hasAnyTiming)) continue;

      runs.sort((a, b) => laneOrder(a.lane) - laneOrder(b.lane));
      if (runs.length > maxPairSize) maxPairSize = runs.length;
      const date = parseTsToDate(canonical);
      const timeLabel = fmtClock(date);

      // Pair-level MOV
      let pairMov: number | null = null;
      const withMov = runs.find((r) => r.mov != null);
      if (withMov && withMov.mov != null) pairMov = withMov.mov;

      const winner = runs.find((r) => {
        const res = (r.result || "").trim().toUpperCase();
        return res === "W" || (!res && r.is_winner === 1);
      });

      // Compute finish position for each run: prefer explicit result (W/R/3/4),
      // otherwise rank by finishing ET. Missing ET -> DNF at position N+1.
      const n = runs.length;
      const finishMap = new Map<RunRow, { finish: number | null; winpos: string }>();
      const resultPos = (res: string): number | null => {
        const r = res.trim().toUpperCase();
        if (r === "W") return 1;
        if (r === "R") return 2;
        if (r === "3") return 3;
        if (r === "4") return 4;
        return null;
      };
      const allHaveResult = runs.every((r) => resultPos(r.result || "") !== null);
      if (allHaveResult) {
        for (const r of runs) {
          const pos = resultPos(r.result || "")!;
          finishMap.set(r, { finish: pos, winpos: posLabel(pos) });
        }
      } else {
        const finished = runs.filter((r) => r.ft1320 != null && r.ft1320 > 0 && !r.is_dq);
        const unfinished = runs.filter((r) => !finished.includes(r));
        finished.sort((a, b) => (a.ft1320 ?? 0) - (b.ft1320 ?? 0));
        finished.forEach((r, i) => finishMap.set(r, { finish: i + 1, winpos: posLabel(i + 1) }));
        for (const r of unfinished) {
          finishMap.set(r, { finish: n + 1, winpos: r.is_dq ? "DQ" : "DNF" });
        }
      }

      const hasManualEntry = runs.some((r) => r.manual_entry === 1);
      pairs.push({
        canonical_ts: canonical,
        time_label: timeLabel,
        pair_mov: pairMov,
        winner_car: winner?.car_number ?? null,
        has_manual_entry: hasManualEntry,
        runs: runs.map((r) => {
          const index_value = parseIndex(r.class_index, r.dial_in);
          let over_under_thou: number | null = null;
          if (r.ft1320 != null) {
            const idx = index_value ?? 0;
            over_under_thou = Math.round((r.ft1320 - idx) * 1000);
          }
          const fm = finishMap.get(r) ?? { finish: null, winpos: "" };
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
            run_number: r.manual_run_number != null ? r.manual_run_number : (runNumberMap.get(r) ?? 0),
            index_value,
            over_under_thou,
            remarks: computeRemarks(r),
            finish: fm.finish,
            winpos: fm.winpos,
          } satisfies RoundPrintRun;
        }),
      });
    }

    const isFourWide = maxPairSize > 2;

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
      is_four_wide: maxPairSize > 2,
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
