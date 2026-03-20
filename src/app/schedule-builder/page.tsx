"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveData } from "@/components/LiveDataProvider";
import { RACE_CLASSES, type RaceClass } from "@/lib/schedule-classes";

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
  fixedTime: string;
  fieldSize: number;
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
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function parseTime(s: string): { h: number; m: number } | null {
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

function calcPairs(cars: number): number {
  return cars > 0 ? Math.ceil(cars / 2) : 1;
}

function normalizeRound(r: string): string {
  if (!r) return "";
  const s = r.toUpperCase().trim();
  if (s.startsWith("E")) return `R${s.slice(1)}`;
  return s;
}

function nextRound(lastRound: string): string {
  const s = lastRound.toUpperCase().trim();
  const type = s.charAt(0);
  const num = parseInt(s.slice(1), 10) || 1;
  if (type === "T" && num >= 4) return "Q1";
  if (type === "Q" && num >= 4) return "R1";
  return `${type}${num + 1}`;
}

function isFullFieldRound(round: string): boolean {
  const s = round.toUpperCase().trim();
  return s.startsWith("Q") || s.startsWith("T");
}

function isFirstElim(round: string): boolean {
  const s = normalizeRound(round);
  return s === "R1";
}

function carsForNextRound(prevCars: number, prevRound: string, newRound: string, fieldSize?: number): number {
  if (isFullFieldRound(newRound)) return prevCars;
  if (isFirstElim(newRound)) {
    if (fieldSize && fieldSize > 0) return fieldSize;
    return prevCars;
  }
  const prevNorm = normalizeRound(prevRound);
  const newNorm = normalizeRound(newRound);
  if (isFullFieldRound(prevRound) && isFirstElim(newRound)) {
    return fieldSize && fieldSize > 0 ? fieldSize : prevCars;
  }
  if (prevNorm !== newNorm) return Math.ceil(prevCars / 2);
  return prevCars;
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

function prevRoundInfo(
  entries: PlanEntry[],
  actuals: ScheduleActual[],
  className: string,
  classCode: string,
  otherDayEntries?: PlanEntry[]
): { round: string; cars: number } | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.className === className && e.round && !e.isBreak) {
      return { round: e.round, cars: e.cars };
    }
  }
  const classActuals = actuals
    .filter((a) => a.category === className)
    .sort((a, b) => {
      const na = normalizeRound(a.round);
      const nb = normalizeRound(b.round);
      return nb.localeCompare(na);
    });
  if (classActuals.length > 0) {
    const latest = classActuals[0];
    return { round: latest.round, cars: latest.totalRuns };
  }
  if (otherDayEntries) {
    for (let i = otherDayEntries.length - 1; i >= 0; i--) {
      const e = otherDayEntries[i];
      if (e.className === className && e.round && !e.isBreak) {
        return { round: e.round, cars: e.cars };
      }
    }
  }
  return null;
}

function parseActualTime(ts: string, racingStartHour: number = 8): { h: number; m: number } | null {
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

function fmtActualTime(ts: string, racingStartHour: number = 8): string {
  const parsed = parseActualTime(ts, racingStartHour);
  if (!parsed) return ts;
  return fmtTime(parsed.h, parsed.m);
}

export default function ScheduleBuilderPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-nhra-darker flex items-center justify-center"><div className="w-10 h-10 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" /></div>}>
      <ScheduleBuilderInner />
    </Suspense>
  );
}

function ScheduleBuilderInner() {
  const live = useLiveData();
  const searchParams = useSearchParams();
  const eventCode = live.config?.eventCode || "";
  const season = live.config?.season || "";
  const eventName = live.config?.eventName || "";
  const eventKey = eventCode && season ? `${eventCode}_${season}` : "";

  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [startTime, setStartTime] = useState("8:00 AM");
  const [delayMinutes, setDelayMinutes] = useState(0);
  const [planDate, setPlanDate] = useState(() => {
    const sp = searchParams.get("date");
    if (sp) return sp;
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      return u.searchParams.get("date") || "";
    }
    return "";
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [actuals, setActuals] = useState<ScheduleActual[]>([]);
  const [otherDayEntries, setOtherDayEntries] = useState<PlanEntry[]>([]);
  const racingStartHour = live.config?.racingStartHour ?? 8;

  const dragIdx = useRef<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);

  useEffect(() => {
    const sp = searchParams.get("date");
    if (sp && sp !== planDate) setPlanDate(sp);
  }, [searchParams, planDate]);

  const loadPlan = useCallback(async () => {
    if (!eventKey || !planDate) return;
    setLoading(true);
    try {
      const [dayRes, allRes] = await Promise.all([
        fetch(`/api/schedule-plan?event_key=${encodeURIComponent(eventKey)}&date=${encodeURIComponent(planDate)}`),
        fetch(`/api/schedule-plan?event_key=${encodeURIComponent(eventKey)}`),
      ]);
      const dayData = await dayRes.json();
      const allData = await allRes.json();
      const allPlans: { date?: string; startTime?: string; delayMinutes?: number; entries?: PlanEntry[] }[] = allData.plans || [];

      let foundPlan = dayData.plan;
      if (!foundPlan) {
        foundPlan = allPlans.find((p) => p.date === planDate && p.entries && p.entries.length > 0) || null;
      }

      if (foundPlan && foundPlan.entries?.length > 0) {
        const loaded = (foundPlan.entries || []).map((e: PlanEntry) => ({
          ...e,
          fixedTime: e.fixedTime || "",
          fieldSize: e.fieldSize || 0,
        }));
        setEntries(loaded);
        setStartTime(foundPlan.startTime || "8:00 AM");
        setDelayMinutes(foundPlan.delayMinutes || 0);
      } else {
        setEntries([]);
        setStartTime("8:00 AM");
        setDelayMinutes(0);
      }

      const other: PlanEntry[] = [];
      for (const p of allPlans) {
        if (p.date && p.date !== planDate && p.entries) {
          for (const e of p.entries) other.push({ ...e, fixedTime: e.fixedTime || "", fieldSize: e.fieldSize || 0 });
        }
      }
      setOtherDayEntries(other);
    } catch (err) {
      console.error("Load plan error:", err);
    }
    setLoading(false);
  }, [eventKey, planDate]);

  const loadActuals = useCallback(async () => {
    if (!eventCode || !season) return;
    try {
      const res = await fetch(`/api/stats?type=schedule&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}`);
      const data = await res.json();
      setActuals(data.schedule || []);
    } catch (err) {
      console.error("Load actuals error:", err);
    }
  }, [eventCode, season]);

  useEffect(() => {
    if (eventKey && planDate) loadPlan();
  }, [eventKey, planDate, loadPlan]);

  useEffect(() => {
    if (eventKey) loadActuals();
  }, [eventKey, loadActuals]);

  useEffect(() => {
    if (actuals.length === 0 || entries.length === 0) return;

    const dayActuals = planDate
      ? actuals.filter((a) => {
          const datePart = a.firstTimestamp?.split(" ")[0] || "";
          const [m, d, y] = datePart.split("/");
          if (!m || !d || !y) return false;
          const isoDate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
          return isoDate === planDate;
        })
      : actuals;

    if (dayActuals.length === 0) return;

    let changed = false;
    const actualGroups = groupActuals(dayActuals);
    let actualCursor = 0;
    const updated = entries.map((entry) => {
      if (entry.status === "completed") return entry;
      const group = !entry.isBreak && actualCursor < actualGroups.length ? actualGroups[actualCursor] : null;
      if (group) {
        actualCursor += 1;
        changed = true;
        const actualCategory = group[0].category;
        const actualRound = group[0].round;
        const actualPairs = group.reduce((sum, item) => sum + item.pairCount, 0);
        const actualCars = group.reduce((sum, item) => sum + item.totalRuns, 0);
        return {
          ...entry,
          className: actualCategory,
          round: actualRound,
          cars: actualCars,
          pairs: actualPairs,
          status: "completed" as const,
          actualStart: group[0].firstTimestamp,
          actualEnd: group[group.length - 1].lastTimestamp,
          actualPairs,
        };
      }
      return entry;
    });
    if (changed) setEntries(updated);
  }, [actuals, entries, planDate]);

  const savePlan = async () => {
    if (!eventKey) return;
    setSaving(true);
    try {
      await fetch("/api/schedule-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_key: eventKey, startTime, delayMinutes, date: planDate, entries, eventName }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Save plan error:", err);
    }
    setSaving(false);
  };

  const addEntry = (rc: RaceClass, isBreak: boolean) => {
    const prev = isBreak ? null : prevRoundInfo(entries, actuals, rc.name, rc.code, otherDayEntries);
    let round = "T1";
    let cars = 0;
    let pairs = 0;
    const fs = rc.fieldSize || 0;

    if (prev) {
      round = nextRound(prev.round);
      cars = carsForNextRound(prev.cars, prev.round, round, fs);
      pairs = calcPairs(cars);
    }

    if (isBreak) {
      round = "";
      cars = 0;
      pairs = 1;
    }

    const entry: PlanEntry = {
      id: uid(),
      className: rc.name,
      classCode: rc.code,
      round,
      cars,
      pairs,
      perPairSec: rc.perPairSec,
      plannedDurationSec: isBreak ? rc.perPairSec : pairs * rc.perPairSec,
      isBreak,
      fixedTime: "",
      fieldSize: fs,
      status: "planned",
      actualStart: null,
      actualEnd: null,
      actualPairs: null,
    };
    setEntries((p) => [...p, entry]);
    setShowPicker(false);
    setPickerSearch("");
  };

  const addBreak = () => {
    setEntries((p) => [
      ...p,
      {
        id: uid(),
        className: "Break",
        classCode: "",
        round: "",
        cars: 0,
        pairs: 1,
        perPairSec: 600,
        plannedDurationSec: 600,
        isBreak: true,
        fixedTime: "",
        fieldSize: 0,
        status: "planned",
        actualStart: null,
        actualEnd: null,
        actualPairs: null,
      },
    ]);
  };

  const updateEntry = (id: string, updates: Partial<PlanEntry>) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== id || e.status === "completed") return e;
        const merged = { ...e, ...updates };
        if ("cars" in updates && !merged.isBreak) {
          merged.pairs = calcPairs(merged.cars);
          merged.plannedDurationSec = merged.pairs * merged.perPairSec;
        }
        if ("pairs" in updates && merged.isBreak) {
          merged.plannedDurationSec = merged.pairs * merged.perPairSec;
        }
        if ("round" in updates && merged.classCode && !merged.isBreak) {
          const pi = prevRoundInfo(prev, actuals, merged.className, merged.classCode, otherDayEntries);
          if (pi && merged.cars === 0) {
            const autoCars = carsForNextRound(pi.cars, pi.round, merged.round, merged.fieldSize);
            merged.cars = autoCars;
            merged.pairs = calcPairs(autoCars);
            merged.plannedDurationSec = merged.pairs * merged.perPairSec;
          }
        }
        return merged;
      })
    );
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleDragStart = (idx: number) => {
    if (entries[idx].status === "completed") return;
    dragIdx.current = idx;
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    dragOverIdx.current = idx;
  };
  const handleDrop = () => {
    if (dragIdx.current === null || dragOverIdx.current === null) return;
    if (entries[dragOverIdx.current]?.status === "completed") return;
    const n = [...entries];
    const [moved] = n.splice(dragIdx.current, 1);
    n.splice(dragOverIdx.current, 0, moved);
    setEntries(n);
    dragIdx.current = null;
    dragOverIdx.current = null;
  };

  const copyShareLink = () => {
    if (!eventKey || !planDate) return;
    navigator.clipboard.writeText(`${window.location.origin}/day/${eventKey}?date=${planDate}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const projectedTimes = (() => {
    const start = parseTime(startTime);
    if (!start) return [];
    const times: { startH: number; startM: number; endH: number; endM: number }[] = [];
    let curMin = hmToMinutes(start.h, start.m);
    let delayApplied = false;

    for (const entry of entries) {
      if (entry.status === "completed" && entry.actualEnd) {
        const actEnd = parseActualTime(entry.actualEnd, racingStartHour);
        if (actEnd) {
          const actStart = entry.actualStart ? parseActualTime(entry.actualStart, racingStartHour) : null;
          const startHM = actStart ? { h: actStart.h, m: actStart.m } : minutesToHM(curMin);
          times.push({
            startH: startHM.h,
            startM: startHM.m,
            endH: actEnd.h,
            endM: actEnd.m,
          });
          curMin = hmToMinutes(actEnd.h, actEnd.m);
          continue;
        }
      }

      let startMin = curMin;
      if (!delayApplied) {
        startMin += delayMinutes;
        delayApplied = true;
      }
      if (entry.fixedTime) {
        const pinned = parseTime(entry.fixedTime);
        if (pinned) {
          const pinnedMin = hmToMinutes(pinned.h, pinned.m);
          if (pinnedMin < curMin) {
            const overlapMin = curMin - pinnedMin;
            startMin = pinnedMin;
            const endMin = startMin + entry.plannedDurationSec / 60;
            const startHM = minutesToHM(startMin);
            const endHM = minutesToHM(endMin);
            times.push({ startH: startHM.h, startM: startHM.m, endH: endHM.h, endM: endHM.m });
            curMin = endMin + overlapMin;
            continue;
          }
          startMin = pinnedMin;
        }
      }

      const endMin = startMin + entry.plannedDurationSec / 60;
      const startHM = minutesToHM(startMin);
      const endHM = minutesToHM(endMin);
      times.push({ startH: startHM.h, startM: startHM.m, endH: endHM.h, endM: endHM.m });
      curMin = endMin;
    }
    return times;
  })();

  const totalDurSec = entries.reduce((s, e) => s + e.plannedDurationSec, 0);
  const projEnd = projectedTimes.length > 0 ? projectedTimes[projectedTimes.length - 1] : null;

  const filteredClasses = pickerSearch
    ? RACE_CLASSES.filter(
        (c) =>
          c.name.toLowerCase().includes(pickerSearch.toLowerCase()) ||
          c.code.toLowerCase().includes(pickerSearch.toLowerCase())
      )
    : RACE_CLASSES;

  if (!live.config) {
    return (
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-4">Schedule Builder</h1>
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          No event locked in. Go to Setup to select an event first.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Schedule Builder</h1>
          <p className="text-gray-400">{eventName}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Date:</label>
            <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} title="Plan date" className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Start:</label>
            <input type="text" value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="8:00 AM" className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm w-28" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Delay:</label>
            <input
              type="number"
              min={0}
              step={5}
              value={delayMinutes}
              onChange={(e) => setDelayMinutes(Math.max(0, parseInt(e.target.value || "0", 10) || 0))}
              title="Delay minutes"
              className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm w-24"
            />
            <span className="text-xs text-gray-500">min</span>
          </div>
          <button onClick={savePlan} disabled={saving} className="px-5 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 text-sm">
            {saving ? "Saving..." : saved ? "Saved!" : "Save"}
          </button>
          <button onClick={copyShareLink} className="px-5 py-2.5 bg-nhra-card border border-nhra-border text-gray-300 rounded-lg font-medium hover:text-white hover:border-nhra-accent/50 transition-colors text-sm">
            {copied ? "Link Copied!" : "Share Link"}
          </button>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button onClick={() => setShowPicker(true)} className="px-4 py-2.5 bg-nhra-red text-white rounded-lg font-medium hover:bg-red-700 transition-colors text-sm flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Class
        </button>
        <button onClick={addBreak} className="px-4 py-2.5 bg-nhra-card border border-nhra-border text-gray-300 rounded-lg font-medium hover:text-white transition-colors text-sm flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          Add Break
        </button>
        <button onClick={() => { loadPlan(); loadActuals(); }} disabled={loading} className="px-4 py-2.5 bg-nhra-card border border-nhra-border text-gray-300 rounded-lg font-medium hover:text-white transition-colors text-sm">
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Schedule Table */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-nhra-border bg-nhra-darker text-gray-400 text-xs uppercase tracking-wider">
                <th className="p-3 w-8">#</th>
                <th className="p-3 text-center w-24">Fixed</th>
                <th className="p-3 text-center" colSpan={2}><span className="text-blue-400">Projected</span></th>
                <th className="p-3 text-left">Category</th>
                <th className="p-3 text-center w-16">Round</th>
                <th className="p-3 text-right w-16">Cars</th>
                <th className="p-3 text-center w-14">Bump</th>
                <th className="p-3 text-right w-14">Prs</th>
                <th className="p-3 text-right w-20">Duration</th>
                <th className="p-3 text-center" colSpan={2}><span className="text-green-400">Actual</span></th>
                <th className="p-3 w-10"></th>
              </tr>
              <tr className="border-b border-nhra-border bg-nhra-darker text-gray-500 text-xs">
                <th className="p-1"></th>
                <th className="p-1 text-center">Time</th>
                <th className="p-1 text-center">Start</th>
                <th className="p-1 text-center">End</th>
                <th className="p-1"></th>
                <th className="p-1"></th>
                <th className="p-1"></th>
                <th className="p-1"></th>
                <th className="p-1"></th>
                <th className="p-1"></th>
                <th className="p-1 text-center">Start</th>
                <th className="p-1 text-center">End</th>
                <th className="p-1"></th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr><td colSpan={13} className="p-12 text-center text-gray-500">No entries yet. Click &quot;Add Class&quot; or &quot;Add Break&quot; to start building.</td></tr>
              )}
              {entries.map((entry, idx) => {
                const pt = projectedTimes[idx];
                const isCompleted = entry.status === "completed";
                return (
                  <tr
                    key={entry.id}
                    draggable={!isCompleted}
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={handleDrop}
                    className={`border-b border-nhra-border/50 transition-colors ${isCompleted ? "bg-green-500/5" : "hover:bg-nhra-border/20 cursor-grab active:cursor-grabbing"}`}
                  >
                    <td className="p-3 text-gray-500 text-center font-mono">{idx + 1}</td>
                    <td className="p-2 text-center">
                      {isCompleted ? (
                        <span className="text-gray-500 text-xs font-mono">{entry.fixedTime || ""}</span>
                      ) : (
                        <input
                          type="text"
                          value={entry.fixedTime || ""}
                          onChange={(e) => updateEntry(entry.id, { fixedTime: e.target.value })}
                          placeholder="—"
                          className="bg-nhra-darker border border-nhra-border rounded px-2 py-1 text-xs text-orange-400 w-20 text-center font-mono placeholder-gray-600"
                        />
                      )}
                    </td>
                    <td className="p-3 text-center font-mono text-blue-400 text-xs whitespace-nowrap">
                      {pt ? fmtTime(pt.startH, pt.startM) : ""}
                    </td>
                    <td className="p-3 text-center font-mono text-blue-400/70 text-xs whitespace-nowrap">
                      {pt ? fmtTime(pt.endH, pt.endM) : ""}
                    </td>
                    <td className="p-3 text-white font-medium">
                      {isCompleted && !entry.isBreak && entry.actualPairs != null && entry.actualPairs < entry.pairs ? (
                        <svg className="w-4 h-4 text-orange-400 inline mr-2 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                      ) : isCompleted ? (
                        <svg className="w-4 h-4 text-green-400 inline mr-2 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : null}
                      {entry.isBreak ? <span className="text-yellow-400">{entry.className}</span> : entry.className}
                      {isCompleted && !entry.isBreak && entry.actualPairs != null && entry.actualPairs < entry.pairs && (
                        <span className="ml-2 text-orange-400 text-xs font-normal">({entry.pairs - entry.actualPairs} pairs remaining)</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {!entry.isBreak ? (
                        isCompleted ? (
                          <span className="px-2 py-1 bg-nhra-darker rounded text-xs text-gray-300">{entry.round}</span>
                        ) : (
                          <select
                            value={entry.round}
                            onChange={(e) => updateEntry(entry.id, { round: e.target.value })}
                            title="Round"
                            className="bg-nhra-darker border border-nhra-border rounded px-2 py-1 text-xs text-white w-16"
                          >
                            {["T1","T2","T3","T4","Q1","Q2","Q3","Q4","R1","R2","R3","R4","R5","R6","R7","E1","E2","E3","E4","E5","E6","E7","F"].map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        )
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {!entry.isBreak ? (
                        isCompleted ? (
                          <span className="font-mono text-gray-300">{entry.cars}</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            value={entry.cars || ""}
                            onChange={(e) => updateEntry(entry.id, { cars: parseInt(e.target.value) || 0 })}
                            className="bg-nhra-darker border border-nhra-border rounded px-2 py-1 text-xs text-white w-14 text-right font-mono"
                            placeholder="0"
                          />
                        )
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {!entry.isBreak && entry.classCode ? (
                        isCompleted ? (
                          <span className="font-mono text-gray-500 text-xs">{entry.fieldSize || "—"}</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            value={entry.fieldSize || ""}
                            onChange={(e) => updateEntry(entry.id, { fieldSize: parseInt(e.target.value) || 0 })}
                            className="bg-nhra-darker border border-nhra-border rounded px-1 py-1 text-xs text-orange-400 w-12 text-center font-mono"
                            placeholder="—"
                            title="Field size / bump spot"
                          />
                        )
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="p-3 text-right font-mono text-gray-300">
                      {entry.isBreak ? (entry.pairs > 1 ? entry.pairs : "—") : entry.pairs || "—"}
                    </td>
                    <td className="p-3 text-right text-nhra-accent font-mono font-medium">
                      {fmtDurSec(entry.plannedDurationSec)}
                    </td>
                    <td className="p-3 text-center font-mono text-green-400 text-xs whitespace-nowrap">
                      {entry.actualStart ? fmtActualTime(entry.actualStart, racingStartHour) : ""}
                    </td>
                    <td className="p-3 text-center font-mono text-green-400/70 text-xs whitespace-nowrap">
                      {entry.actualEnd ? fmtActualTime(entry.actualEnd, racingStartHour) : ""}
                    </td>
                    <td className="p-3 text-center">
                      {!isCompleted ? (
                        <button onClick={() => removeEntry(entry.id)} className="text-gray-500 hover:text-red-400 transition-colors" title="Remove">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      ) : isCompleted && !entry.isBreak && entry.actualPairs != null && entry.actualPairs < entry.pairs ? (
                        <div className="flex items-center gap-2 justify-center">
                          <button
                            onClick={() => {
                              const remaining = (entry.pairs - (entry.actualPairs || 0)) * 2;
                              const rc = RACE_CLASSES.find((c) => c.code === entry.classCode || c.name === entry.className);
                              const perPair = rc?.perPairSec || entry.perPairSec;
                              const remPairs = calcPairs(remaining);
                              setEntries((prev) => {
                                const updated = prev.map((e) => e.id === entry.id ? { ...e, pairs: entry.actualPairs! } : e);
                                return [...updated, {
                                  id: uid(),
                                  className: entry.className,
                                  classCode: entry.classCode,
                                  round: entry.round,
                                  cars: remaining,
                                  pairs: remPairs,
                                  perPairSec: perPair,
                                  plannedDurationSec: remPairs * perPair,
                                  isBreak: false,
                                  fixedTime: "",
                                  fieldSize: entry.fieldSize || 0,
                                  status: "planned",
                                  actualStart: null,
                                  actualEnd: null,
                                  actualPairs: null,
                                }];
                              });
                            }}
                            className="text-orange-400 hover:text-orange-300 transition-colors text-xs whitespace-nowrap"
                            title="Add remaining cars back to schedule"
                          >
                            Re-add
                          </button>
                          <button
                            onClick={() => setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, pairs: entry.actualPairs! } : e))}
                            className="text-gray-500 hover:text-gray-300 transition-colors text-xs whitespace-nowrap"
                            title="Dismiss — ignore remaining cars"
                          >
                            Ignore
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer summary */}
      {entries.length > 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-4 flex flex-wrap gap-6 items-center">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Entries</p>
            <p className="text-xl font-bold text-white">{entries.length}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Duration</p>
            <p className="text-xl font-bold text-white">{fmtDurSec(totalDurSec)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Projected End</p>
            <p className="text-xl font-bold text-white">{projEnd ? fmtTime(projEnd.endH, projEnd.endM) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Completed</p>
            <p className="text-xl font-bold text-green-400">{entries.filter((e) => e.status === "completed").length} / {entries.length}</p>
          </div>
        </div>
      )}

      {/* Class Picker Modal */}
      {showPicker && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowPicker(false)}>
          <div className="bg-nhra-dark border border-nhra-border rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-nhra-border">
              <h2 className="text-lg font-bold text-white mb-3">Add Class to Schedule</h2>
              <input
                type="text"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search classes..."
                autoFocus
                className="w-full px-4 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-500"
              />
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {filteredClasses.map((rc, i) => {
                const prev = rc.isRacing ? prevRoundInfo(entries, actuals, rc.name, rc.code, otherDayEntries) : null;
                const nr = prev ? nextRound(prev.round) : "T1";
                const bumpLabel = rc.fieldSize ? ` · Bump: ${rc.fieldSize}` : "";
                const hint = prev ? `Next: ${nr} (${prev.cars} cars${bumpLabel})` : (rc.fieldSize ? `Bump: ${rc.fieldSize}` : "");
                return (
                  <button
                    key={`${rc.name}-${i}`}
                    onClick={() => addEntry(rc, !rc.isRacing)}
                    className="w-full text-left px-4 py-3 rounded-lg hover:bg-nhra-card transition-colors flex items-center justify-between group"
                  >
                    <div>
                      <span className="text-white font-medium group-hover:text-nhra-accent transition-colors">{rc.name}</span>
                      {rc.code && <span className="text-gray-500 ml-2 text-xs">[{rc.code}]</span>}
                      {hint && <span className="text-blue-400/60 ml-2 text-xs">{hint}</span>}
                    </div>
                    <span className="text-gray-500 text-xs font-mono">
                      {rc.isRacing ? fmtDurSec(rc.perPairSec) + "/pair" : fmtDurSec(rc.perPairSec)}
                    </span>
                  </button>
                );
              })}
              {filteredClasses.length === 0 && <p className="text-gray-500 text-center py-8">No classes match your search.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
