"use client";

import { useState, useEffect, useCallback } from "react";
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

function addSeconds(h: number, m: number, sec: number): { h: number; m: number } {
  const totalMin = h * 60 + m + sec / 60;
  return { h: Math.floor(totalMin / 60) % 24, m: Math.round(totalMin % 60) };
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

function fmtDurSec(sec: number): string {
  if (sec <= 0) return "—";
  const mins = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (mins >= 60) {
    const hr = Math.floor(mins / 60);
    const rm = mins % 60;
    return rm > 0 ? `${hr}h ${rm}m` : `${hr}h`;
  }
  return `${mins}m${String(s).padStart(2, "0")}s`;
}

function parseTs(ts: string, racingStartHour: number = 8): Date | null {
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
    else if (!ampm && hour >= 1 && hour < racingStartHour) hour += 12;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hour, parseInt(mm), parseInt(ss || "0"));
  } catch {
    return null;
  }
}

function sortKey(ts: string, rsh: number = 8): string {
  const d = parseTs(ts, rsh);
  if (!d) return ts;
  return d.toISOString();
}

function fmtTime12(ts: string, rsh: number = 8): string {
  const d = parseTs(ts, rsh);
  if (!d) return ts;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
}

function fmtTimeShort(ts: string, rsh: number = 8): string {
  const d = parseTs(ts, rsh);
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
  };
  return aliases[normalized] || normalized;
}

function groupActuals(actuals: ScheduleActual[]): ScheduleActual[][] {
  const groups: ScheduleActual[][] = [];
  for (const actual of actuals) {
    const lastGroup = groups[groups.length - 1];
    const lastActual = lastGroup?.[lastGroup.length - 1];
    if (
      lastActual &&
      normalizeCategoryName(lastActual.category) === normalizeCategoryName(actual.category) &&
      normalizeRound(lastActual.round) === normalizeRound(actual.round)
    ) {
      lastGroup.push(actual);
    } else {
      groups.push([actual]);
    }
  }
  return groups;
}

function parseActualTs(ts: string, racingStartHour: number = 8): { h: number; m: number } | null {
  try {
    const parts = ts.split(" ");
    const timePart = parts[1];
    const ampm = parts[2]?.toUpperCase();
    if (!timePart) return null;
    const [hh, mm] = timePart.split(":");
    let h = parseInt(hh, 10);
    if (ampm === "PM" && h !== 12) h += 12;
    else if (ampm === "AM" && h === 12) h = 0;
    else if (!ampm && h >= 1 && h < racingStartHour) h += 12;
    return { h, m: parseInt(mm, 10) };
  } catch {
    return null;
  }
}

function fmtActualTime(ts: string): string {
  const parsed = parseActualTs(ts);
  if (!parsed) return ts;
  return fmtTime(parsed.h, parsed.m);
}

export default function PublicSchedulePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const eventKey = (params.eventKey as string) || "";
  const dateParam = searchParams.get("date") || "";
  const [eventCode, season] = eventKey.includes("_") ? eventKey.split("_", 2) : [eventKey, ""];

  const [plan, setPlan] = useState<{ startTime: string; eventName: string; date: string; delayMinutes?: number; entries: PlanEntry[] } | null>(null);
  const [actuals, setActuals] = useState<ScheduleActual[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasPlan, setHasPlan] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const planUrl = dateParam
        ? `/api/schedule-plan?event_key=${encodeURIComponent(eventKey)}&date=${encodeURIComponent(dateParam)}`
        : `/api/schedule-plan?event_key=${encodeURIComponent(eventKey)}`;
      const [planRes, actualRes] = await Promise.all([
        fetch(planUrl),
        eventCode && season
          ? fetch(`/api/stats?type=schedule&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}`)
          : Promise.resolve(null),
      ]);

      const planData = await planRes.json();
      if (planData.plan && planData.plan.entries?.length > 0) {
        setPlan(planData.plan);
        setHasPlan(true);
      } else if (planData.plans?.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const match = planData.plans.find((p: PlanData) => p.date === today) || planData.plans[planData.plans.length - 1];
        if (match?.entries?.length > 0) {
          setPlan(match);
          setHasPlan(true);
        }
      }

      if (actualRes) {
        const actualData = await actualRes.json();
        setActuals(actualData.schedule || []);
      }
    } catch (err) {
      console.error("Load error:", err);
    }
    setLoading(false);
  }, [eventKey, eventCode, season, dateParam]);

  useEffect(() => {
    if (eventKey) loadData();
  }, [eventKey, loadData]);

  const targetDate = dateParam || plan?.date || "";
  const targetDateMDY = isoToMDY(targetDate);

  const buildRows = (): { rows: ScheduleRow[]; projectedEnd: string } => {
    const actualEntries = actuals
      .filter((s) => !targetDateMDY || fmtDateShort(s.firstTimestamp) === targetDateMDY)
      .sort((a, b) => sortKey(a.firstTimestamp).localeCompare(sortKey(b.firstTimestamp)));

    let sessionRows: DayScheduleRow[];

    if (hasPlan && plan) {
      const actualGroups = groupActuals(actualEntries);
      let actualCursor = 0;

      sessionRows = plan.entries.flatMap<DayScheduleRow>((entry) => {
        const group = !entry.isBreak && actualCursor < actualGroups.length ? actualGroups[actualCursor] : null;
        if (group) {
          actualCursor += 1;
          return group.map((match) => ({
            type: "session" as const,
            actual: match.firstTimestamp,
            end: match.lastTimestamp,
            category: match.category,
            round: match.round,
            numCars: match.totalRuns,
            pairs: match.pairCount,
            durationMin: match.durationMinutes,
            isPlanned: false,
            fixedTime: entry.fixedTime || "",
          }));
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

      for (let i = actualCursor; i < actualGroups.length; i++) {
        const rows = actualGroups[i].map((a) => ({
          type: "session" as const,
          actual: a.firstTimestamp,
          end: a.lastTimestamp,
          category: a.category,
          round: a.round,
          numCars: a.totalRuns,
          pairs: a.pairCount,
          durationMin: a.durationMinutes,
          isPlanned: false,
        }));
        const insertIdx = sessionRows.findIndex((r) => r.isPlanned);
        if (insertIdx >= 0) sessionRows.splice(insertIdx, 0, ...rows);
        else sessionRows.push(...rows);
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

    if (hasPlan && plan) {
      const start = parseTime(plan.startTime);
      if (start) {
        let curMin = hmToMinutes(start.h, start.m);
        let delayApplied = false;
        for (const row of sessionRows) {
          if (row.isPlanned) {
            let startMin = curMin;
            if (!delayApplied) {
              startMin += plan.delayMinutes || 0;
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
            }
          }
        }
      }
    }

    const combined: ScheduleRow[] = [];
    for (let i = 0; i < sessionRows.length; i++) {
      if (i > 0 && !sessionRows[i].isPlanned && !sessionRows[i - 1].isPlanned) {
        const prevEnd = parseTs(sessionRows[i - 1].end);
        const thisStart = parseTs(sessionRows[i].actual);
        if (prevEnd && thisStart) {
          const gapMin = Math.round((thisStart.getTime() - prevEnd.getTime()) / 60000);
          if (gapMin >= 10) {
            combined.push({ type: "downtime", startTs: sessionRows[i - 1].end, endTs: sessionRows[i].actual, durationMin: gapMin });
          }
        }
      }
      combined.push(sessionRows[i]);
    }

    const lastRow = sessionRows[sessionRows.length - 1];
    let projectedEnd = "";
    if (lastRow?.projEnd) projectedEnd = lastRow.projEnd;
    else if (lastRow && !lastRow.isPlanned && lastRow.end) projectedEnd = fmtTimeShort(lastRow.end);

    return { rows: combined, projectedEnd };
  };

  const { rows, projectedEnd } = buildRows();

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

  if (rows.length === 0) {
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
          <h1 className="text-2xl font-bold text-white">{plan?.eventName || `Event ${eventCode}`}</h1>
          <div className="flex flex-wrap gap-4 mt-2 text-white/80 text-sm">
            {plan?.date && <span>{new Date(plan.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>}
            {plan?.startTime && <span>Start: {plan.startTime}</span>}
            {!!plan?.delayMinutes && <span>Delay: {plan.delayMinutes}m</span>}
            {projectedEnd && <span>Projected End: {projectedEnd}</span>}
          </div>
        </div>

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
                          <span className="inline-flex items-center gap-2 text-yellow-500 text-xs font-medium">Downtime</span>
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
          NHRA Timing Data &mdash; Updated live
        </div>
      </div>
    </div>
  );
}
