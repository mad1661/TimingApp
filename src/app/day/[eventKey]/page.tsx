"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";

interface PlanEntry {
  id: string;
  className: string;
  classCode: string;
  round: string;
  cars: number;
  pairs: number;
  perPairSec: number;
  plannedDurationSec: number;
  isBreak: boolean;
  fixedTime?: string;
  status: "planned" | "completed";
  actualStart: string | null;
  actualEnd: string | null;
  actualPairs: number | null;
}

interface ScheduleActual {
  category: string;
  round: string;
  firstTimestamp: string;
  lastTimestamp: string;
  pairCount: number;
  totalRuns: number;
  durationMinutes: number;
}

interface PlanData {
  startTime: string;
  date: string;
  eventName: string;
  delayMinutes?: number;
  entries: PlanEntry[];
}

interface DayScheduleRow {
  type: "session";
  actual: string;
  end: string;
  category: string;
  round: string;
  numCars: number;
  pairs: number;
  durationMin: number;
  isPlanned?: boolean;
  projStart?: string;
  projEnd?: string;
  fixedTime?: string;
  plannedPairs?: number;
  plannedPerPairSec?: number;
}

interface DowntimeRow {
  type: "downtime";
  startTs: string;
  endTs: string;
  durationMin: number;
}

type ScheduleRow = DayScheduleRow | DowntimeRow;

function parseTime(s: string): { h: number; m: number } | null {
  const clean = s.trim().toUpperCase();
  const match = clean.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2] || "0", 10);
  const ampm = match[3];
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return { h, m };
}

function hmToMinutes(h: number, m: number): number {
  return h * 60 + m;
}

function minutesToHM(totalMin: number): { h: number; m: number } {
  const normalized = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  return { h: Math.floor(normalized / 60), m: normalized % 60 };
}

function fmtTime(h: number, m: number): string {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function parseTs(ts: string): Date | null {
  try {
    const parts = ts.split(" ");
    const datePart = parts[0];
    const timePart = parts[1];
    const ampm = parts[2]?.toUpperCase();
    const [month, day, year] = datePart.split("/");
    const [hh, mm, ss] = timePart.split(":");
    let hour = parseInt(hh, 10);
    if (ampm === "PM" && hour !== 12) hour += 12;
    else if (ampm === "AM" && hour === 12) hour = 0;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hour, parseInt(mm), parseInt(ss || "0"));
  } catch {
    return null;
  }
}

function sortKey(ts: string): string {
  const d = parseTs(ts);
  if (!d) return ts;
  return d.toISOString();
}

function fmtTime12(ts: string): string {
  const d = parseTs(ts);
  if (!d) return ts;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
}

function fmtTimeShort(ts: string): string {
  const d = parseTs(ts);
  if (!d) return ts;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function fmtDuration(minutes: number): string {
  if (minutes <= 0) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtPerPair(durationMin: number, pairs: number): string {
  if (pairs <= 1 || durationMin <= 0) return "—";
  const totalSec = Math.round((durationMin * 60) / (pairs - 1));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${String(s).padStart(2, "0")}s`;
}

function roundLabel(r: string): string {
  if (r === "T") return "TT";
  if (r === "Q") return "Q";
  if (r.startsWith("Q")) return `Q-${r.slice(1)}`;
  if (r.startsWith("TT") || r.startsWith("T")) return r;
  if (r.startsWith("E")) return `R-${r.slice(1)}`;
  if (r === "F" || r.toLowerCase() === "final") return "Final";
  return r;
}

function fmtDateShort(ts: string): string {
  return ts.split(" ")[0] || ts;
}

function fmtDateLabel(ts: string): string {
  const d = parseTs(ts);
  if (!d) return ts;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function isoToMDY(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

function normalizeRound(r: string): string {
  if (!r) return "";
  const s = r.toUpperCase().trim();
  if (s.startsWith("E")) return `R${s.slice(1)}`;
  return s;
}

function normalizeCategoryName(name: string): string {
  const normalized = name.toUpperCase().trim().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    "STOCK ELIMINATOR": "STOCK",
    "LEGENDS NITRO FUNNY CAR": "LEGACY NITRO FUNNY CAR",
  };
  return aliases[normalized] || normalized;
}

function mergeActualsByClass(actuals: ScheduleActual[]): Map<string, ScheduleActual> {
  const merged = new Map<string, ScheduleActual>();
  for (const actual of actuals) {
    const key = `${normalizeCategoryName(actual.category)}|||${normalizeRound(actual.round)}`;
    const existing = merged.get(key);
    if (existing) {
      existing.totalRuns += actual.totalRuns;
      existing.pairCount += actual.pairCount;
      existing.durationMinutes += actual.durationMinutes;
      if (actual.firstTimestamp < existing.firstTimestamp) existing.firstTimestamp = actual.firstTimestamp;
      if (actual.lastTimestamp > existing.lastTimestamp) existing.lastTimestamp = actual.lastTimestamp;
    } else {
      merged.set(key, { ...actual });
    }
  }
  return merged;
}

function todayDateStr(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${now.getFullYear()}`;
}

const REFRESH_INTERVAL_MS = 30000;

export default function PublicScheduleWrapper() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-nhra-darker flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-nhra-red border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Loading schedule...</p>
          </div>
        </div>
      }
    >
      <PublicSchedulePage />
    </Suspense>
  );
}

function PublicSchedulePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const eventKey = (params.eventKey as string) || "";
  const dateParam = searchParams.get("date") || "";
  const [eventCode, season] = eventKey.includes("_") ? eventKey.split("_", 2) : [eventKey, ""];

  const [allPlans, setAllPlans] = useState<PlanData[]>([]);
  const [actuals, setActuals] = useState<ScheduleActual[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(dateParam || "today");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const [planRes, actualRes] = await Promise.all([
        fetch(`/api/schedule-plan?event_key=${encodeURIComponent(eventKey)}`),
        eventCode && season
          ? fetch(`/api/stats?type=schedule&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}`)
          : Promise.resolve(null),
      ]);

      const planData = await planRes.json();
      const plans: PlanData[] = planData.plans || (planData.plan ? [planData.plan] : []);
      setAllPlans(plans.filter((p) => p.entries?.length > 0));

      if (actualRes) {
        const actualData = await actualRes.json();
        setActuals(actualData.schedule || []);
      }
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Load error:", err);
    }
    setLoading(false);
  }, [eventKey, eventCode, season]);

  useEffect(() => {
    if (eventKey) loadData();
  }, [eventKey, loadData]);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      if (eventKey) loadData(false);
    }, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [eventKey, loadData]);

  const allDates = (() => {
    const d = new Set<string>();
    for (const s of actuals) d.add(fmtDateShort(s.firstTimestamp));
    for (const p of allPlans) {
      if (p.date) d.add(isoToMDY(p.date));
    }
    return [...d].sort();
  })();

  const today = todayDateStr();

  const visibleDate = (() => {
    if (selectedDate === "today") {
      if (allDates.includes(today)) return today;
      return allDates.length > 0 ? allDates[allDates.length - 1] : "";
    }
    return selectedDate;
  })();

  const dayPlan = allPlans.find((p) => isoToMDY(p.date) === visibleDate) || null;
  const eventName = allPlans[0]?.eventName || `Event ${eventCode}`;

  const buildRows = (): { rows: ScheduleRow[]; projectedEnd: string } => {
    const actualEntries = actuals
      .filter((s) => !visibleDate || fmtDateShort(s.firstTimestamp) === visibleDate)
      .sort((a, b) => sortKey(a.firstTimestamp).localeCompare(sortKey(b.firstTimestamp)));

    let sessionRows: DayScheduleRow[];

    if (dayPlan) {
      const merged = mergeActualsByClass(actualEntries);
      const matched = new Set<string>();

      sessionRows = dayPlan.entries.flatMap<DayScheduleRow>((entry) => {
        if (entry.isBreak) {
          return [{
            type: "session" as const,
            actual: "",
            end: "",
            category: entry.className,
            round: entry.round,
            numCars: 0,
            pairs: entry.pairs,
            durationMin: Math.round(entry.plannedDurationSec / 60),
            isPlanned: true,
            fixedTime: entry.fixedTime || "",
          }];
        }

        const key = `${normalizeCategoryName(entry.className)}|||${normalizeRound(entry.round)}`;
        if (matched.has(key)) {
          return [{
            type: "session" as const,
            actual: "",
            end: "",
            category: entry.className,
            round: entry.round,
            numCars: 0,
            pairs: entry.pairs,
            durationMin: Math.round(entry.plannedDurationSec / 60),
            isPlanned: true,
            fixedTime: entry.fixedTime || "",
          }];
        }

        const actual = merged.get(key);
        if (actual) {
          matched.add(key);
          return [{
            type: "session" as const,
            actual: actual.firstTimestamp,
            end: actual.lastTimestamp,
            category: actual.category,
            round: actual.round,
            numCars: actual.totalRuns,
            pairs: actual.pairCount,
            durationMin: actual.durationMinutes,
            isPlanned: false,
            fixedTime: entry.fixedTime || "",
            plannedPairs: entry.pairs,
            plannedPerPairSec: entry.perPairSec,
          }];
        }

        return [{
          type: "session" as const,
          actual: "",
          end: "",
          category: entry.className,
          round: entry.round,
          numCars: 0,
          pairs: entry.pairs,
          durationMin: Math.round(entry.plannedDurationSec / 60),
          isPlanned: true,
          fixedTime: entry.fixedTime || "",
        }];
      });

      for (const [key, actual] of merged) {
        if (!matched.has(key)) {
          const insertIdx = sessionRows.findIndex((r) => r.isPlanned);
          const row: DayScheduleRow = {
            type: "session",
            actual: actual.firstTimestamp,
            end: actual.lastTimestamp,
            category: actual.category,
            round: actual.round,
            numCars: actual.totalRuns,
            pairs: actual.pairCount,
            durationMin: actual.durationMinutes,
            isPlanned: false,
          };
          if (insertIdx >= 0) sessionRows.splice(insertIdx, 0, row);
          else sessionRows.push(row);
        }
      }
    } else {
      sessionRows = actualEntries.map((entry) => ({
        type: "session" as const,
        actual: entry.firstTimestamp,
        end: entry.lastTimestamp,
        category: entry.category,
        round: entry.round,
        numCars: entry.totalRuns,
        pairs: entry.pairCount,
        durationMin: entry.durationMinutes,
        isPlanned: false,
      }));
    }

    if (dayPlan) {
      const start = parseTime(dayPlan.startTime);
      if (start) {
        let curMin = hmToMinutes(start.h, start.m);
        let delayApplied = false;
        for (const row of sessionRows) {
          if (row.isPlanned) {
            let startMin = curMin;
            if (!delayApplied) {
              startMin += dayPlan.delayMinutes || 0;
              delayApplied = true;
            }
            if (row.fixedTime) {
              const pinned = parseTime(row.fixedTime);
              if (pinned) {
                const pinnedMin = hmToMinutes(pinned.h, pinned.m);
                if (pinnedMin < curMin) {
                  const overlapMin = curMin - pinnedMin;
                  startMin = pinnedMin;
                  const endMin = startMin + row.durationMin;
                  row.projStart = fmtTime(minutesToHM(startMin).h, minutesToHM(startMin).m);
                  row.projEnd = fmtTime(minutesToHM(endMin).h, minutesToHM(endMin).m);
                  curMin = endMin + overlapMin;
                  continue;
                }
                startMin = pinnedMin;
              }
            }
            const endMin = startMin + row.durationMin;
            row.projStart = fmtTime(minutesToHM(startMin).h, minutesToHM(startMin).m);
            row.projEnd = fmtTime(minutesToHM(endMin).h, minutesToHM(endMin).m);
            curMin = endMin;
          } else if (row.end) {
            const actEnd = parseTs(row.end);
            if (actEnd) {
              curMin = hmToMinutes(actEnd.getHours(), actEnd.getMinutes());
              if (row.plannedPairs && row.pairs < row.plannedPairs) {
                const remaining = row.plannedPairs - row.pairs;
                let paceMin: number;
                if (row.pairs >= 2 && row.durationMin > 0) {
                  paceMin = row.durationMin / (row.pairs - 1);
                } else if (row.plannedPerPairSec) {
                  paceMin = row.plannedPerPairSec / 60;
                } else {
                  paceMin = 3;
                }
                curMin += Math.round(remaining * paceMin);
              }
            }
          }
        }
      }
    }

    const chronoActuals = sessionRows
      .filter((r) => !r.isPlanned && r.actual && r.end)
      .sort((a, b) => sortKey(a.actual).localeCompare(sortKey(b.actual)));

    const dtRows: DowntimeRow[] = [];
    for (let i = 1; i < chronoActuals.length; i++) {
      const prevEnd = parseTs(chronoActuals[i - 1].end);
      const thisStart = parseTs(chronoActuals[i].actual);
      if (prevEnd && thisStart) {
        const gapMin = Math.round((thisStart.getTime() - prevEnd.getTime()) / 60000);
        if (gapMin >= 2) {
          dtRows.push({ type: "downtime", startTs: chronoActuals[i - 1].end, endTs: chronoActuals[i].actual, durationMin: gapMin });
        }
      }
    }

    const combined: ScheduleRow[] = [...sessionRows];
    for (const dt of dtRows) {
      const dtStart = parseTs(dt.startTs);
      if (!dtStart) { combined.push(dt); continue; }
      let bestIdx = combined.length;
      for (let i = 0; i < combined.length; i++) {
        const row = combined[i];
        if (row.type === "session" && !row.isPlanned && row.actual) {
          const rowStart = parseTs(row.actual);
          if (rowStart && rowStart > dtStart) { bestIdx = i; break; }
        }
      }
      combined.splice(bestIdx, 0, dt);
    }

    const lastRow = sessionRows[sessionRows.length - 1];
    let projectedEnd = "";
    if (lastRow?.projEnd) projectedEnd = lastRow.projEnd;
    else if (lastRow && !lastRow.isPlanned && lastRow.end) projectedEnd = fmtTimeShort(lastRow.end);

    return { rows: combined, projectedEnd };
  };

  const { rows, projectedEnd } = buildRows();

  const sessions = rows.filter((r): r is DayScheduleRow => r.type === "session");
  const actualSessions = sessions.filter((s) => !s.isPlanned);
  const dayPairs = actualSessions.reduce((s, r) => s + r.pairs, 0);
  const dayRuns = actualSessions.reduce((s, r) => s + r.numCars, 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-nhra-darker flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-nhra-red border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading schedule...</p>
        </div>
      </div>
    );
  }

  if (rows.length === 0 && allPlans.length === 0) {
    return (
      <div className="min-h-screen bg-nhra-darker flex items-center justify-center px-4">
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center max-w-md">
          <h1 className="text-2xl font-bold text-white mb-2">No Schedule Available</h1>
          <p className="text-gray-400">No schedule has been created for this event yet, and no runs have been recorded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-nhra-darker">
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="bg-nhra-red rounded-xl px-6 py-5 mb-6">
          <h1 className="text-2xl font-bold text-white">{eventName}</h1>
          <div className="flex flex-wrap gap-4 mt-2 text-white/80 text-sm">
            {dayPlan?.date && <span>{new Date(dayPlan.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>}
            {dayPlan?.startTime && <span>Start: {dayPlan.startTime}</span>}
            {!!dayPlan?.delayMinutes && <span>Delay: {dayPlan.delayMinutes}m</span>}
            {projectedEnd && <span>Projected End: {projectedEnd}</span>}
            {actualSessions.length > 0 && (
              <>
                <span>{dayPairs} pairs</span>
                <span>{dayRuns} runs</span>
              </>
            )}
          </div>
        </div>

        {/* Day selector */}
        {allDates.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => setSelectedDate("today")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedDate === "today" ? "bg-nhra-red text-white" : "bg-nhra-card border border-nhra-border text-gray-400 hover:text-white"}`}
            >
              {allDates.includes(today) ? "Today" : "Latest"}
            </button>
            {allDates.map((date) => (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedDate === date ? "bg-nhra-red text-white" : "bg-nhra-card border border-nhra-border text-gray-400 hover:text-white"} ${date === today ? "ring-1 ring-nhra-red/50" : ""}`}
              >
                {fmtDateLabel(date + " 12:00:00")}
              </button>
            ))}
          </div>
        )}

        {/* Schedule Table */}
        <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-nhra-border bg-nhra-darker text-gray-400 text-xs uppercase tracking-wider">
                  <th className="text-left p-3 pl-5 w-24">Start</th>
                  <th className="text-left p-3 w-24">End</th>
                  <th className="text-left p-3">Eliminator</th>
                  <th className="text-center p-3 w-20">Round</th>
                  <th className="text-right p-3 w-16"># Cars</th>
                  <th className="text-right p-3 w-16">Pairs</th>
                  <th className="text-right p-3 w-20">Duration</th>
                  <th className="text-right p-3 pr-5 w-20">Per Pair</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  if (row.type === "downtime") {
                    return (
                      <tr key={`dt-${i}`} className="border-b border-nhra-border/50 bg-yellow-500/5">
                        <td className="p-2 pl-5 font-mono text-yellow-500/70 whitespace-nowrap text-xs">{fmtTime12(row.startTs)}</td>
                        <td className="p-2 font-mono text-yellow-500/70 whitespace-nowrap text-xs">{fmtTime12(row.endTs)}</td>
                        <td colSpan={3} className="p-2 text-center">
                          <span className="inline-flex items-center gap-2 text-yellow-500 text-xs font-medium">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Downtime
                          </span>
                        </td>
                        <td className="p-2" />
                        <td className="p-2 text-right text-yellow-500/80 font-mono text-xs">{fmtDuration(row.durationMin)}</td>
                        <td className="p-2 pr-5" />
                      </tr>
                    );
                  }

                  if (row.isPlanned) {
                    return (
                      <tr key={i} className="border-b border-nhra-border/50 bg-blue-500/5">
                        <td className="p-3 pl-5 font-mono text-blue-400 whitespace-nowrap text-xs">{row.projStart || "—"}</td>
                        <td className="p-3 font-mono text-blue-400/70 whitespace-nowrap text-xs">{row.projEnd || "—"}</td>
                        <td className="p-3 text-blue-300/80 font-medium">{row.category}</td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-1 bg-blue-900/30 rounded text-xs text-blue-300 font-medium">{roundLabel(row.round)}</span>
                        </td>
                        <td className="p-3 text-right font-mono text-blue-400/60">—</td>
                        <td className="p-3 text-right font-mono text-blue-400/60">{row.pairs}</td>
                        <td className="p-3 text-right text-blue-400/60">~{fmtDuration(row.durationMin)}</td>
                        <td className="p-3 text-right pr-5 font-mono text-blue-400/60">—</td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={i} className="border-b border-nhra-border/50">
                      <td className="p-3 pl-5 font-mono text-green-400 font-medium whitespace-nowrap">{fmtTime12(row.actual)}</td>
                      <td className="p-3 font-mono text-gray-300 whitespace-nowrap">{fmtTime12(row.end)}</td>
                      <td className="p-3 text-white font-medium">{row.category}</td>
                      <td className="p-3 text-center">
                        <span className="px-2 py-1 bg-nhra-darker rounded text-xs text-gray-300 font-medium">{roundLabel(row.round)}</span>
                      </td>
                      <td className="p-3 text-right font-mono text-gray-300">{row.numCars}</td>
                      <td className="p-3 text-right font-mono text-gray-300">{row.pairs}</td>
                      <td className="p-3 text-right text-gray-400">{fmtDuration(row.durationMin)}</td>
                      <td className="p-3 text-right pr-5 font-mono text-nhra-accent font-medium">{fmtPerPair(row.durationMin, row.pairs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 text-center text-gray-600 text-xs">
          NHRA Timing Data &mdash; Auto-refreshes every 30s
          {lastRefresh && <span className="ml-2">(last: {lastRefresh.toLocaleTimeString()})</span>}
        </div>
      </div>
    </div>
  );
}
