"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useLiveData } from "@/components/LiveDataProvider";

interface ScheduleEntry {
  category: string;
  round: string;
  firstTimestamp: string;
  lastTimestamp: string;
  totalRuns: number;
  pairCount: number;
  durationMinutes: number;
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

function fmtDate(ts: string, rsh: number = 8): string {
  const d = parseTs(ts, rsh);
  if (!d) return ts;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "2-digit", day: "2-digit", year: "numeric" });
}

function fmtDateShort(ts: string): string {
  return ts.split(" ")[0] || ts;
}

function fmtDateLabel(ts: string, rsh: number = 8): string {
  const d = parseTs(ts, rsh);
  if (!d) return ts;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
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

function todayDateStr(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${now.getFullYear()}`;
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

const DOWNTIME_THRESHOLD_MIN = 10;

function normalizeRoundSched(r: string): string {
  if (!r) return "";
  const s = r.toUpperCase().trim();
  if (s.startsWith("E")) return `R${s.slice(1)}`;
  return s;
}

function isoToMDY(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

function mdyToIso(mdy: string): string {
  if (!mdy) return "";
  const [m, d, y] = mdy.split("/");
  if (!m || !d || !y) return mdy;
  return `${y}-${m}-${d}`;
}

function normalizeCategoryName(name: string): string {
  const normalized = name.toUpperCase().trim().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    "STOCK ELIMINATOR": "STOCK",
  };
  return aliases[normalized] || normalized;
}

function groupActualEntries(actualEntries: ScheduleEntry[]): ScheduleEntry[][] {
  const groups: ScheduleEntry[][] = [];
  for (const entry of actualEntries) {
    const lastGroup = groups[groups.length - 1];
    const lastEntry = lastGroup?.[lastGroup.length - 1];
    if (
      lastEntry &&
      normalizeCategoryName(lastEntry.category) === normalizeCategoryName(entry.category) &&
      normalizeRoundSched(lastEntry.round) === normalizeRoundSched(entry.round)
    ) {
      lastGroup.push(entry);
    } else {
      groups.push([entry]);
    }
  }
  return groups;
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

function parseStartTime(s: string): { h: number; m: number } | null {
  if (!s) return null;
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

function addSecsToHM(h: number, m: number, sec: number): { h: number; m: number } {
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

function fmtHM(h: number, m: number): string {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtHM24(timeStr: string): string {
  if (!timeStr) return timeStr;
  if (timeStr.includes("/")) return fmtTime12(timeStr);
  const [hh, mm] = timeStr.split(":").map(Number);
  if (isNaN(hh)) return timeStr;
  return fmtHM(hh, mm || 0);
}

interface DowntimeRow {
  type: "downtime";
  startTs: string;
  endTs: string;
  durationMin: number;
  reason?: string;
  manualId?: string;
}

type ScheduleRow = DayScheduleRow | DowntimeRow;

interface ManualDowntime {
  id: string;
  reason: string;
  reasonLabel: string;
  startTime: string;
  endTime: string;
  date: string;
  durationMin: number;
}

const DOWNTIME_REASONS = [
  { code: "A", label: "Accident" },
  { code: "CL", label: "Centerline/Blocks" },
  { code: "DQ", label: "Disqualify" },
  { code: "E", label: "Timing/Electrical" },
  { code: "F", label: "Fire" },
  { code: "L", label: "Liquid" },
  { code: "LU", label: "Locked Up" },
  { code: "M", label: "Marketing" },
  { code: "MISC", label: "Miscellaneous" },
  { code: "O", label: "Oil" },
  { code: "P", label: "Parts" },
  { code: "R", label: "Rain" },
  { code: "T", label: "Tow" },
  { code: "TP", label: "Track Prep" },
  { code: "TR", label: "Trap" },
  { code: "TV", label: "TV" },
  { code: "W", label: "Wait" },
];

interface PlanData {
  startTime: string;
  date: string;
  eventName?: string;
  delayMinutes?: number;
  entries: { className: string; round: string; pairs: number; perPairSec: number; plannedDurationSec: number; isBreak: boolean; fixedTime?: string; status: string; }[];
}

export default function SchedulePage() {
  const live = useLiveData();
  const rsh = live.config?.racingStartHour ?? 8;
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [plans, setPlans] = useState<Map<string, PlanData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>("today");
  const [showDowntime, setShowDowntime] = useState(true);
  const [copied, setCopied] = useState(false);
  const [manualDowntimes, setManualDowntimes] = useState<ManualDowntime[]>([]);
  const [showDtModal, setShowDtModal] = useState(false);
  const [dtReason, setDtReason] = useState("MISC");
  const [dtStart, setDtStart] = useState("");
  const [dtEnd, setDtEnd] = useState("");
  const [dtDate, setDtDate] = useState("");
  const [dtSaving, setDtSaving] = useState(false);

  const eventCode = live.config?.eventCode;
  const season = live.config?.season;
  const eventKey = eventCode && season ? `${eventCode}_${season}` : "";

  const loadSchedule = useCallback(async () => {
    if (!eventCode || !season) return;
    setLoading(true);
    try {
      const [schedRes, planRes, dtRes] = await Promise.all([
        fetch(`/api/stats?type=schedule&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}`),
        eventKey ? fetch(`/api/schedule-plan?event_key=${encodeURIComponent(eventKey)}`) : Promise.resolve(null),
        fetch(`/api/downtime?event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}`),
      ]);
      const schedData = await schedRes.json();
      setSchedule(schedData.schedule || []);
      if (planRes) {
        const planData = await planRes.json();
        const planArr: PlanData[] = planData.plans || (planData.plan ? [planData.plan] : []);
        const m = new Map<string, PlanData>();
        for (const p of planArr) {
          if (p.date && p.entries?.length > 0) {
            m.set(isoToMDY(p.date), p);
          }
        }
        setPlans(m);
      }
      const dtData = await dtRes.json();
      setManualDowntimes(dtData.entries || []);
      setLoaded(true);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, [eventCode, season, eventKey]);

  useEffect(() => {
    if (eventCode && season) loadSchedule();
  }, [eventCode, season, loadSchedule]);

  const dates = (() => {
    const d = new Set(schedule.map((s) => fmtDateShort(s.firstTimestamp)));
    for (const dateMDY of plans.keys()) d.add(dateMDY);
    for (const md of manualDowntimes) {
      if (md.date) d.add(isoToMDY(md.date));
    }
    return [...d].sort();
  })();

  const today = todayDateStr();
  const hasToday = dates.includes(today);

  const visibleDates = (() => {
    if (selectedDay === "all") return dates;
    if (selectedDay === "today") {
      if (hasToday) return [today];
      return dates.length > 0 ? [dates[dates.length - 1]] : [];
    }
    return dates.includes(selectedDay) ? [selectedDay] : [];
  })();

  const buildDayRows = (date: string): { rows: ScheduleRow[]; downtimeMin: number; hasActualData: boolean; projectedEnd: string } => {
    const actualEntries = schedule
      .filter((s) => fmtDateShort(s.firstTimestamp) === date)
      .sort((a, b) => sortKey(a.firstTimestamp, rsh).localeCompare(sortKey(b.firstTimestamp, rsh)));

    const dayPlan = plans.get(date) || null;
    const hasPlan = dayPlan !== null;
    const hasActualData = actualEntries.length > 0;

    let sessionRows: DayScheduleRow[];

    if (hasPlan) {
      const actualGroups = groupActualEntries(actualEntries);
      let actualCursor = 0;

      sessionRows = dayPlan.entries.flatMap<DayScheduleRow>((pe) => {
        const group = !pe.isBreak && actualCursor < actualGroups.length ? actualGroups[actualCursor] : null;
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
            fixedTime: pe.fixedTime || "",
          }));
        }
        return [{
          type: "session" as const,
          actual: "",
          end: "",
          category: pe.className,
          round: pe.round,
          numCars: 0,
          pairs: pe.pairs,
          durationMin: Math.round(pe.plannedDurationSec / 60),
          isPlanned: true,
          fixedTime: pe.fixedTime || "",
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

    if (hasPlan && dayPlan) {
      const start = parseStartTime(dayPlan.startTime);
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
              const pinned = parseStartTime(row.fixedTime);
              if (pinned) {
                const pinnedMin = hmToMinutes(pinned.h, pinned.m);
                if (pinnedMin < curMin) {
                  const overlapMin = curMin - pinnedMin;
                  startMin = pinnedMin;
                  const endMin = startMin + row.durationMin;
                  row.projStart = fmtHM(minutesToHM(startMin).h, minutesToHM(startMin).m);
                  row.projEnd = fmtHM(minutesToHM(endMin).h, minutesToHM(endMin).m);
                  curMin = endMin + overlapMin;
                  continue;
                }
                startMin = pinnedMin;
              }
            }
            const endMin = startMin + row.durationMin;
            row.projStart = fmtHM(minutesToHM(startMin).h, minutesToHM(startMin).m);
            row.projEnd = fmtHM(minutesToHM(endMin).h, minutesToHM(endMin).m);
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

    const lastRow = sessionRows[sessionRows.length - 1];
    let projectedEnd = "";
    if (lastRow?.projEnd) {
      projectedEnd = lastRow.projEnd;
    } else if (lastRow && !lastRow.isPlanned && lastRow.end) {
      projectedEnd = fmtTimeShort(lastRow.end, rsh);
    }

    const dayManualDt = manualDowntimes.filter((md) => md.date && isoToMDY(md.date) === date);

    const combined: ScheduleRow[] = [];
    let totalDowntimeMin = 0;

    for (let i = 0; i < sessionRows.length; i++) {
      if (i > 0 && showDowntime && !sessionRows[i].isPlanned && !sessionRows[i - 1].isPlanned) {
        const prevEnd = parseTs(sessionRows[i - 1].end);
        const thisStart = parseTs(sessionRows[i].actual);
        if (prevEnd && thisStart) {
          const gapMin = Math.round((thisStart.getTime() - prevEnd.getTime()) / 60000);
          if (gapMin >= DOWNTIME_THRESHOLD_MIN) {
            combined.push({ type: "downtime", startTs: sessionRows[i - 1].end, endTs: sessionRows[i].actual, durationMin: gapMin });
            totalDowntimeMin += gapMin;
          }
        }
      }
      combined.push(sessionRows[i]);
    }

    for (const md of dayManualDt) {
      const dtRow: DowntimeRow = {
        type: "downtime",
        startTs: md.startTime,
        endTs: md.endTime,
        durationMin: md.durationMin,
        reason: md.reasonLabel,
        manualId: md.id,
      };
      totalDowntimeMin += md.durationMin;

      let inserted = false;
      for (let i = 0; i < combined.length; i++) {
        const row = combined[i];
        if (row.type === "session" && !row.isPlanned && row.actual) {
          const rowStart = parseTs(row.actual);
          if (rowStart) {
            const [hh, mm] = md.startTime.split(":").map(Number);
            const dtH = hh >= 1 && hh <= 6 ? hh + 12 : hh;
            if (dtH < rowStart.getHours() || (dtH === rowStart.getHours() && (mm || 0) < rowStart.getMinutes())) {
              combined.splice(i, 0, dtRow);
              inserted = true;
              break;
            }
          }
        }
      }
      if (!inserted) combined.push(dtRow);
    }

    return { rows: combined, downtimeMin: totalDowntimeMin, hasActualData, projectedEnd };
  };

  const savePlanDelay = async (date: string, delayMinutes: number) => {
    const plan = plans.get(date);
    if (!plan || !eventKey) return;
    const normalizedDelay = Math.max(0, delayMinutes);
    setPlans((prev) => {
      const next = new Map(prev);
      next.set(date, { ...plan, delayMinutes: normalizedDelay });
      return next;
    });
    try {
      await fetch("/api/schedule-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_key: eventKey,
          eventName: plan.eventName || live.config?.eventName || "",
          date: mdyToIso(date),
          startTime: plan.startTime,
          delayMinutes: normalizedDelay,
          entries: plan.entries,
        }),
      });
    } catch (err) {
      console.error("Save plan delay error:", err);
      loadSchedule();
    }
  };

  const saveDowntime = async () => {
    if (!eventCode || !season || !dtStart || !dtEnd) return;
    setDtSaving(true);
    const reason = DOWNTIME_REASONS.find((r) => r.code === dtReason);
    try {
      await fetch("/api/downtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_code: eventCode,
          season,
          reason: dtReason,
          reasonLabel: reason?.label || dtReason,
          startTime: dtStart,
          endTime: dtEnd,
          date: dtDate,
        }),
      });
      setShowDtModal(false);
      setDtStart("");
      setDtEnd("");
      loadSchedule();
    } catch (err) {
      console.error("Save downtime error:", err);
    }
    setDtSaving(false);
  };

  const deleteDowntime = async (id: string) => {
    if (!eventCode || !season) return;
    try {
      await fetch(`/api/downtime?event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      loadSchedule();
    } catch (err) {
      console.error("Delete downtime error:", err);
    }
  };

  const totalRuns = schedule.reduce((s, e) => s + e.totalRuns, 0);
  const totalPairs = schedule.reduce((s, e) => s + e.pairCount, 0);
  const categoryCount = new Set(schedule.map((s) => s.category)).size;
  const roundCount = new Set(schedule.map((s) => `${s.category}|${s.round}`)).size;

  if (!live.config) {
    return (
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-4">Schedule</h1>
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          No event locked in. Go to Setup to select an event first.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Daily Schedule</h1>
          <p className="text-gray-400">{live.config.eventName}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Start:</span>
            {[6, 7, 8, 9, 10].map((h) => (
              <button key={h} onClick={() => {
                if (live.config) live.setConfig({ ...live.config, racingStartHour: h });
              }}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${rsh === h ? "bg-nhra-accent text-white" : "bg-nhra-darker border border-nhra-border text-gray-500 hover:text-white"}`}>
                {h}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDowntime}
              onChange={(e) => setShowDowntime(e.target.checked)}
              className="w-4 h-4 rounded border-nhra-border bg-nhra-darker accent-nhra-red"
            />
            Show Downtime
          </label>
          <button
            onClick={() => {
              if (!eventKey) return;
              const url = `${window.location.origin}/day/${eventKey}`;
              navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="px-4 py-2.5 bg-nhra-card border border-nhra-border text-gray-300 rounded-lg font-medium hover:text-white hover:border-nhra-accent/50 transition-colors text-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            {copied ? "Link Copied!" : "Share"}
          </button>
          <button
            onClick={() => {
              const t = todayDateStr();
              const isoDate = `${t.split("/")[2]}-${t.split("/")[0]}-${t.split("/")[1]}`;
              setDtDate(isoDate);
              setDtReason("MISC");
              setDtStart("");
              setDtEnd("");
              setShowDtModal(true);
            }}
            className="px-4 py-2.5 bg-yellow-600 text-white rounded-lg font-medium hover:bg-yellow-700 transition-colors text-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Downtime
          </button>
          <button
            onClick={loadSchedule}
            disabled={loading}
            className="px-5 py-2.5 bg-nhra-red text-white rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? "Loading..." : "Refresh Schedule"}
          </button>
        </div>
      </div>

      {/* Day filter buttons */}
      {dates.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setSelectedDay("today")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedDay === "today" ? "bg-nhra-red text-white" : "bg-nhra-card border border-nhra-border text-gray-400 hover:text-white"}`}
          >
            {hasToday ? "Today" : "Latest Day"}
          </button>
          <button
            onClick={() => setSelectedDay("all")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedDay === "all" ? "bg-nhra-red text-white" : "bg-nhra-card border border-nhra-border text-gray-400 hover:text-white"}`}
          >
            All Days
          </button>
          <div className="w-px bg-nhra-border mx-1" />
          {dates.map((date) => (
            <button
              key={date}
              onClick={() => setSelectedDay(date)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedDay === date ? "bg-nhra-red text-white" : "bg-nhra-card border border-nhra-border text-gray-400 hover:text-white"} ${date === today ? "ring-1 ring-nhra-red/50" : ""}`}
            >
              {fmtDateLabel(date + " 12:00:00")}
            </button>
          ))}
        </div>
      )}

      {/* Summary */}
      {schedule.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-nhra-card border border-nhra-border rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Days</p>
            <p className="text-2xl font-bold text-white mt-1">{dates.length}</p>
          </div>
          <div className="bg-nhra-card border border-nhra-border rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Categories</p>
            <p className="text-2xl font-bold text-white mt-1">{categoryCount}</p>
          </div>
          <div className="bg-nhra-card border border-nhra-border rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Sessions</p>
            <p className="text-2xl font-bold text-white mt-1">{roundCount}</p>
          </div>
          <div className="bg-nhra-card border border-nhra-border rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Pairs</p>
            <p className="text-2xl font-bold text-white mt-1">{totalPairs.toLocaleString()}</p>
          </div>
          <div className="bg-nhra-card border border-nhra-border rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Runs</p>
            <p className="text-2xl font-bold text-white mt-1">{totalRuns.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Day-by-day schedule tables */}
      {visibleDates.map((date) => {
        const { rows, downtimeMin, hasActualData, projectedEnd } = buildDayRows(date);
        const sessions = rows.filter((r): r is DayScheduleRow => r.type === "session");
        const actualSessions = sessions.filter((s) => !s.isPlanned);
        const dayPairs = actualSessions.reduce((s, r) => s + r.pairs, 0);
        const dayRuns = actualSessions.reduce((s, r) => s + r.numCars, 0);
        const firstTime = actualSessions[0] ? fmtTimeShort(actualSessions[0].actual, rsh) : "";
        const lastTime = actualSessions[actualSessions.length - 1] ? fmtTimeShort(actualSessions[actualSessions.length - 1].end, rsh) : "";

        const firstD = actualSessions[0] ? parseTs(actualSessions[0].actual, rsh) : null;
        const lastD = actualSessions[actualSessions.length - 1] ? parseTs(actualSessions[actualSessions.length - 1].end, rsh) : null;
        const totalMin = firstD && lastD ? Math.round((lastD.getTime() - firstD.getTime()) / 60000) : 0;
        const activeMin = Math.max(totalMin - downtimeMin, 1);
        const pairsPerHour = activeMin > 0 ? Math.round((dayPairs / activeMin) * 60 * 10) / 10 : 0;

        const headerBg = hasActualData ? "bg-nhra-red" : "bg-blue-600";

        return (
          <div key={date} className="mb-8">
            <div className={`${headerBg} rounded-t-xl px-5 py-3 flex items-center justify-between flex-wrap gap-3`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center text-white font-bold">
                  {date.split("/")[1]}
                </div>
                <div>
                  <p className="text-white font-bold text-lg">{fmtDate(actualSessions[0]?.actual || date, rsh)}</p>
                  {hasActualData ? (
                    <p className="text-white/70 text-xs">
                      {firstTime} &mdash; {lastTime}
                      {projectedEnd && projectedEnd !== lastTime && (
                        <span className="ml-2 text-blue-200/80">(proj. end: {projectedEnd})</span>
                      )}
                    </p>
                  ) : (
                    <p className="text-white/70 text-xs">
                      Planned Schedule
                      {projectedEnd && <span className="ml-2">(proj. end: {projectedEnd})</span>}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-4 md:gap-6 text-white/90 text-sm flex-wrap items-center">
                {plans.has(date) && (
                  <div className="flex items-center gap-2 bg-white/10 rounded-lg px-2 py-1">
                    <span className="text-xs text-white/70">Delay</span>
                    <button
                      onClick={() => savePlanDelay(date, (plans.get(date)?.delayMinutes || 0) - 15)}
                      className="px-1.5 py-0.5 bg-white/15 hover:bg-white/25 rounded text-white text-xs"
                    >
                      -15
                    </button>
                    <input
                      type="number"
                      min={0}
                      step={5}
                      value={plans.get(date)?.delayMinutes || 0}
                      onChange={(e) => savePlanDelay(date, parseInt(e.target.value || "0", 10) || 0)}
                      className="w-16 px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-xs text-center"
                      title="Delay minutes"
                    />
                    <button
                      onClick={() => savePlanDelay(date, (plans.get(date)?.delayMinutes || 0) + 15)}
                      className="px-1.5 py-0.5 bg-white/15 hover:bg-white/25 rounded text-white text-xs"
                    >
                      +15
                    </button>
                  </div>
                )}
                {plans.has(date) && (
                  <Link
                    href={`/schedule-builder?date=${mdyToIso(date)}`}
                    className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-white text-xs font-medium transition-colors flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit Plan
                  </Link>
                )}
                {hasActualData && (
                  <>
                    <div className="text-right">
                      <p className="font-bold text-lg">{dayPairs}</p>
                      <p className="text-xs text-white/60">pairs</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-lg">{dayRuns}</p>
                      <p className="text-xs text-white/60">runs</p>
                    </div>
                  </>
                )}
                <div className="text-right">
                  <p className="font-bold text-lg">{sessions.length}</p>
                  <p className="text-xs text-white/60">sessions</p>
                </div>
                {hasActualData && (
                  <>
                    <div className="text-right">
                      <p className="font-bold text-lg">{pairsPerHour}</p>
                      <p className="text-xs text-white/60">pairs/hr</p>
                    </div>
                    {downtimeMin > 0 && (
                      <div className="text-right">
                        <p className="font-bold text-lg">{fmtDuration(activeMin)}</p>
                        <p className="text-xs text-white/60">active time</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="bg-nhra-card border border-nhra-border border-t-0 rounded-b-xl overflow-hidden">
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
                          <tr key={`dt-${i}`} className={`border-b border-nhra-border/50 ${row.manualId ? "bg-yellow-500/10" : "bg-yellow-500/5"}`}>
                            <td className="p-2 pl-5 font-mono text-yellow-500/70 whitespace-nowrap text-xs">{row.manualId ? fmtHM24(row.startTs) : fmtTime12(row.startTs, rsh)}</td>
                            <td className="p-2 font-mono text-yellow-500/70 whitespace-nowrap text-xs">{row.manualId ? fmtHM24(row.endTs) : fmtTime12(row.endTs, rsh)}</td>
                            <td colSpan={3} className="p-2 text-center">
                              <span className="inline-flex items-center gap-2 text-yellow-500 text-xs font-medium">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {row.reason || "Downtime"}
                              </span>
                            </td>
                            <td className="p-2" />
                            <td className="p-2 text-right text-yellow-500/80 font-mono text-xs">{fmtDuration(row.durationMin)}</td>
                            <td className="p-2 pr-5 text-center">
                              {row.manualId && (
                                <button onClick={() => deleteDowntime(row.manualId!)} className="text-gray-500 hover:text-red-400 transition-colors" title="Delete">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              )}
                            </td>
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
                            <td className="p-3 text-right pr-5 font-mono text-blue-400/40">—</td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={i} className="border-b border-nhra-border/50 hover:bg-nhra-border/20 transition-colors">
                          <td className="p-3 pl-5 font-mono text-green-400 font-medium whitespace-nowrap">{fmtTime12(row.actual, rsh)}</td>
                          <td className="p-3 font-mono text-gray-300 whitespace-nowrap">{fmtTime12(row.end, rsh)}</td>
                          <td className="p-3 text-white font-medium">
                            <Link href={`/runs?category=${encodeURIComponent(row.category)}`} className="hover:text-nhra-accent transition-colors">
                              {row.category}
                            </Link>
                          </td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-1 bg-nhra-darker rounded text-xs text-gray-300 font-medium">
                              {roundLabel(row.round)}
                            </span>
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
          </div>
        );
      })}

      {loading && schedule.length === 0 && (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-nhra-red border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Loading schedule data...</p>
          </div>
        </div>
      )}

      {!loading && loaded && schedule.length === 0 && manualDowntimes.length === 0 && plans.size === 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          No schedule data found for this event yet. Data will appear as runs come in.
        </div>
      )}

      {showDtModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowDtModal(false)}>
          <div className="bg-nhra-dark border border-nhra-border rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-nhra-border">
              <h2 className="text-lg font-bold text-white">Log Downtime</h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Reason</label>
                <select
                  value={dtReason}
                  onChange={(e) => setDtReason(e.target.value)}
                  title="Downtime reason"
                  className="w-full px-3 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white"
                >
                  {DOWNTIME_REASONS.map((r) => (
                    <option key={r.code} value={r.code}>{r.label} ({r.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Date</label>
                <input
                  type="date"
                  value={dtDate}
                  onChange={(e) => setDtDate(e.target.value)}
                  title="Downtime date"
                  className="w-full px-3 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={dtStart}
                    onChange={(e) => setDtStart(e.target.value)}
                    title="Start time"
                    className="w-full px-3 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">End Time</label>
                  <input
                    type="time"
                    value={dtEnd}
                    onChange={(e) => setDtEnd(e.target.value)}
                    title="End time"
                    className="w-full px-3 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white"
                  />
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-nhra-border flex justify-end gap-3">
              <button
                onClick={() => setShowDtModal(false)}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveDowntime}
                disabled={dtSaving || !dtStart || !dtEnd}
                className="px-5 py-2 bg-yellow-600 text-white rounded-lg font-medium hover:bg-yellow-700 transition-colors disabled:opacity-50 text-sm"
              >
                {dtSaving ? "Saving..." : "Save Downtime"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
