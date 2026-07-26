"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveData } from "@/components/LiveDataProvider";
import {
  buildLadder,
  categoryKindFor,
  type LadderEntry,
  type Occupant,
} from "@/lib/class-elims";

// Mirrors ClassElimBreakdown from src/lib/db.ts (serialized over the API).
interface CECar {
  car_number: string;
  name: string;
  designation: string;
  et: number | null;
  index: number | null;
  underOver: number | null;
  bestRound: string | null;
  bestTimestamp: string | null;
  runCount: number;
  seed: number;
  excluded: boolean;
  transmission: "auto" | "stick" | null;
  transSource: "designation" | "override" | "fixed" | null;
  combo: { key: string; label: string } | null;
  noTime: boolean;
}

interface Breakdown {
  category: string;
  categoryKind: "stock" | "super_stock" | "other";
  roundsUsed: string[];
  totalCars: number;
  classes: { designation: string; cars: CECar[] }[];
  singles: CECar[];
  combos: { key: string; label: string; cars: CECar[] }[];
  unresolved: CECar[];
  noDesignation: CECar[];
  excludedCars: CECar[];
  config: { trans: Record<string, "auto" | "stick">; excluded: string[] };
}

function fmt(n: number | null, digits = 3): string {
  if (n === null || n === undefined) return "—";
  return n.toFixed(digits);
}

function fmtUnder(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(3)}`;
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const escape = (v: string): string => {
    if (v == null) return "";
    if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = [header.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Ladder bracket rendering ──────────────────────────────────────────────

function SlotLine({ occ, showClass }: { occ: Occupant; showClass: boolean }) {
  if (occ.kind === "none") {
    return <div className="h-9 invisible" />;
  }
  if (occ.kind === "bye") {
    return (
      <div className="h-9 flex items-center px-2 border-b border-nhra-border text-gray-500 italic text-xs">
        BYE
      </div>
    );
  }
  if (occ.kind === "tbd") {
    return <div className="h-9 border-b border-nhra-border" />;
  }
  const e = occ.entry;
  return (
    <div className="h-9 flex items-center gap-2 px-2 border-b border-nhra-border min-w-0">
      <span className="text-[10px] text-gray-500 w-4 shrink-0 text-right">{e.seed}</span>
      <span className="text-xs font-bold text-nhra-accent shrink-0">{e.car_number}</span>
      <span className="text-xs text-white truncate">{e.name}</span>
      {showClass && e.designation && (
        <span className="text-[10px] text-gray-400 shrink-0">{e.designation}</span>
      )}
      <span className="text-[10px] text-gray-400 ml-auto shrink-0">{fmtUnder(e.underOver)}</span>
    </div>
  );
}

function LadderBracket({
  title,
  entries,
  showClass,
}: {
  title: string;
  entries: LadderEntry[];
  showClass: boolean;
}) {
  const ladder = useMemo(() => buildLadder(entries), [entries]);
  const roundName = (i: number, total: number) =>
    i === total - 1 ? "Final" : `Round ${i + 1}`;

  return (
    <div className="ladder-block bg-nhra-card border border-nhra-border rounded-xl p-4 mb-6 overflow-x-auto">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-white font-bold text-lg">{title}</h3>
        <span className="text-xs text-gray-400">
          {entries.length} car{entries.length !== 1 && "s"}
        </span>
      </div>
      <div className="flex gap-6 min-w-fit">
        {ladder.rounds.map((cells, ri) => (
          <div key={ri} className="flex flex-col w-56 shrink-0">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 text-center">
              {roundName(ri, ladder.rounds.length)}
            </p>
            <div className="flex flex-col justify-around grow gap-3">
              {cells.map((cell, ci) => {
                const empty = cell.top.kind === "none" && cell.bottom.kind === "none";
                return (
                  <div
                    key={ci}
                    className={`rounded border ${empty ? "border-transparent invisible" : "border-nhra-border bg-nhra-darker/40"}`}
                  >
                    <SlotLine occ={cell.top} showClass={showClass} />
                    <SlotLine occ={cell.bottom} showClass={showClass} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex flex-col w-56 shrink-0">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 text-center">Winner</p>
          <div className="flex flex-col justify-around grow">
            <div className="rounded border border-nhra-border bg-nhra-darker/40">
              <div className="h-9 border-b border-nhra-border" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Car row (breakdown tables) ────────────────────────────────────────────

function CarRow({
  car,
  showClass,
  onScratch,
  onTrans,
}: {
  car: CECar;
  showClass?: boolean;
  onScratch?: (car: CECar) => void;
  onTrans?: (car: CECar, call: "stick" | "auto") => void;
}) {
  return (
    <tr className="border-b border-nhra-border/50 last:border-0">
      <td className="py-1.5 pr-2 text-gray-500 text-xs text-right w-6">{car.seed || ""}</td>
      <td className="py-1.5 pr-3 font-bold text-nhra-accent whitespace-nowrap">{car.car_number}</td>
      <td className="py-1.5 pr-3 text-white truncate max-w-[160px]">{car.name || "—"}</td>
      {showClass && <td className="py-1.5 pr-3 text-gray-300 whitespace-nowrap">{car.designation || "—"}</td>}
      <td className="py-1.5 pr-3 text-gray-300 text-right whitespace-nowrap">{fmt(car.et)}</td>
      <td className="py-1.5 pr-3 text-gray-400 text-right whitespace-nowrap">{fmt(car.index, 2)}</td>
      <td className={`py-1.5 pr-3 text-right font-semibold whitespace-nowrap ${car.underOver !== null && car.underOver < 0 ? "text-green-400" : "text-gray-300"}`}>
        {car.noTime ? "no time" : fmtUnder(car.underOver)}
      </td>
      <td className="py-1.5 text-right whitespace-nowrap">
        {onTrans && (
          <span className="inline-flex rounded overflow-hidden border border-nhra-border mr-2 print:hidden">
            {(["stick", "auto"] as const).map((call) => (
              <button
                key={call}
                onClick={() => onTrans(car, call)}
                className={`px-2 py-0.5 text-[10px] font-bold uppercase ${
                  car.transmission === call
                    ? "bg-nhra-red text-white"
                    : "bg-nhra-darker text-gray-400 hover:text-white"
                }`}
              >
                {call}
              </button>
            ))}
          </span>
        )}
        {onScratch && (
          <button
            onClick={() => onScratch(car)}
            title={car.excluded ? "Restore to class" : "Scratch (didn't make the call)"}
            className="px-2 py-0.5 text-[10px] font-bold rounded border border-nhra-border text-gray-400 hover:text-white hover:border-red-500 print:hidden"
          >
            {car.excluded ? "RESTORE" : "SCRATCH"}
          </button>
        )}
      </td>
    </tr>
  );
}

function GroupTable({
  cars,
  showClass,
  onScratch,
  onTrans,
}: {
  cars: CECar[];
  showClass?: boolean;
  onScratch?: (car: CECar) => void;
  onTrans?: (car: CECar, call: "stick" | "auto") => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-nhra-border">
          <td className="pb-1 pr-2 text-right">#</td>
          <td className="pb-1 pr-3">Car</td>
          <td className="pb-1 pr-3">Driver</td>
          {showClass && <td className="pb-1 pr-3">Class</td>}
          <td className="pb-1 pr-3 text-right">ET</td>
          <td className="pb-1 pr-3 text-right">Index</td>
          <td className="pb-1 pr-3 text-right">Un/Ov</td>
          <td className="pb-1" />
        </tr>
      </thead>
      <tbody>
        {cars.map((c) => (
          <CarRow key={c.car_number} car={c} showClass={showClass} onScratch={onScratch} onTrans={onTrans} />
        ))}
      </tbody>
    </table>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function ClassElimsPage() {
  const live = useLiveData();
  const selectedEvent = live.config?.eventCode || "";
  const selectedSeason = live.config?.season || "";

  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [availableRounds, setAvailableRounds] = useState<string[]>([]);
  const [selectedRounds, setSelectedRounds] = useState<Set<string>>(new Set());
  const [filtersLoading, setFiltersLoading] = useState(true);

  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"breakdown" | "ladders">("breakdown");

  useEffect(() => {
    if (!selectedEvent || !selectedSeason) { setFiltersLoading(false); return; }
    setFiltersLoading(true);
    fetch(`/api/runs?event_code=${encodeURIComponent(selectedEvent)}&season=${encodeURIComponent(selectedSeason)}&limit=1`)
      .then((r) => r.json())
      .then((data) => {
        const cats: string[] = data.filters?.categories || [];
        setCategories(cats);
        // Default to the first Stock/Super Stock category at this event.
        const preferred = cats.find((c) => categoryKindFor(c) !== "other");
        setCategory((cur) => cur || preferred || cats[0] || "");
        const rounds: string[] = (data.filters?.rounds || []).filter(
          (r: string) => r.startsWith("Q") || r.startsWith("T"),
        );
        setAvailableRounds(rounds);
        setSelectedRounds(new Set(rounds.filter((r: string) => r.startsWith("Q"))));
      })
      .catch(console.error)
      .finally(() => setFiltersLoading(false));
  }, [selectedEvent, selectedSeason]);

  const digest = useCallback(async (cat: string, rounds: Set<string>) => {
    if (!selectedEvent || !selectedSeason || !cat) return;
    setLoading(true);
    setError(null);
    try {
      const roundsParam = rounds.size > 0 ? `&rounds=${encodeURIComponent([...rounds].join(","))}` : "";
      const res = await fetch(
        `/api/stats?type=class-elims&event_code=${encodeURIComponent(selectedEvent)}&season=${encodeURIComponent(selectedSeason)}&category=${encodeURIComponent(cat)}${roundsParam}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBreakdown(data.breakdown || null);
    } catch (err) {
      console.error(err);
      setError("Failed to digest qualifying");
    } finally {
      setLoading(false);
    }
  }, [selectedEvent, selectedSeason]);

  // Refresh the digest automatically when the live poll pulls new runs.
  useEffect(() => {
    if (breakdown) digest(breakdown.category, selectedRounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.dataVersion]);

  async function saveConfig(next: { trans: Record<string, "auto" | "stick">; excluded: string[] }) {
    if (!breakdown) return;
    setSaving(true);
    try {
      await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "save-class-elims",
          event_code: selectedEvent,
          season: selectedSeason,
          category: breakdown.category,
          trans: next.trans,
          excluded: next.excluded,
        }),
      });
      await digest(breakdown.category, selectedRounds);
    } catch (err) {
      console.error(err);
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function setTrans(car: CECar, call: "stick" | "auto") {
    if (!breakdown) return;
    const trans = { ...breakdown.config.trans, [car.car_number]: call };
    saveConfig({ trans, excluded: breakdown.config.excluded });
  }

  function toggleScratch(car: CECar) {
    if (!breakdown) return;
    const excluded = car.excluded
      ? breakdown.config.excluded.filter((c) => c !== car.car_number)
      : [...breakdown.config.excluded, car.car_number];
    saveConfig({ trans: breakdown.config.trans, excluded });
  }

  function toggleRound(r: string) {
    setSelectedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }

  const ladders = useMemo(() => {
    if (!breakdown) return [];
    const list: { title: string; entries: LadderEntry[]; showClass: boolean }[] = [];
    for (const cls of breakdown.classes) {
      list.push({ title: cls.designation, entries: cls.cars as LadderEntry[], showClass: false });
    }
    for (const combo of breakdown.combos) {
      if (combo.cars.length >= 2) {
        list.push({ title: combo.label, entries: combo.cars as LadderEntry[], showClass: true });
      }
    }
    return list;
  }, [breakdown]);

  function exportCsv() {
    if (!breakdown) return;
    const rows: string[][] = [];
    const push = (group: string, cars: CECar[], status = "") => {
      for (const c of cars) {
        rows.push([
          group, String(c.seed || ""), c.car_number, c.name, c.designation,
          c.et !== null ? c.et.toFixed(3) : "", c.index !== null ? c.index.toFixed(2) : "",
          c.underOver !== null ? c.underOver.toFixed(3) : "", status,
        ]);
      }
    };
    for (const cls of breakdown.classes) push(cls.designation, cls.cars, "class ladder");
    for (const combo of breakdown.combos) push(combo.label, combo.cars, combo.cars.length >= 2 ? "combo ladder" : "single entry");
    push("UNRESOLVED (need trans)", breakdown.unresolved, "needs stick/auto");
    push("NO CLASS DESIGNATION", breakdown.noDesignation, "fix class on runs");
    push("SCRATCHED", breakdown.excludedCars, "scratched");
    downloadCsv(
      `class-elims-${selectedEvent}-${selectedSeason}.csv`,
      ["Ladder", "Seed", "Car #", "Driver", "Class", "ET", "Index", "Un/Ov", "Status"],
      rows,
    );
  }

  const attentionCount = breakdown
    ? breakdown.unresolved.length + breakdown.noDesignation.length
    : 0;

  return (
    <div className="max-w-7xl mx-auto class-elims-page">
      <div className="mb-8 print:hidden">
        <h1 className="text-3xl font-bold text-white mb-2">Class Eliminations</h1>
        <p className="text-gray-400">
          Digest qualifying into individual class ladders and stick/auto combos (Stock &amp; Super Stock)
        </p>
      </div>

      {/* Controls */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={filtersLoading}
              className="w-full px-4 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent"
            >
              <option value="">Select category…</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-400 mb-1">Qualifying rounds</label>
            <div className="flex flex-wrap gap-2 pt-1.5">
              {availableRounds.length === 0 && (
                <span className="text-gray-500 text-sm">All Q rounds (default)</span>
              )}
              {availableRounds.map((r) => (
                <label
                  key={r}
                  className={`px-3 py-1.5 rounded-md text-xs cursor-pointer border ${
                    selectedRounds.has(r)
                      ? "bg-nhra-red/10 border-nhra-red/40 text-white"
                      : "bg-nhra-darker border-nhra-border text-gray-500"
                  }`}
                >
                  <input type="checkbox" className="hidden" checked={selectedRounds.has(r)} onChange={() => toggleRound(r)} />
                  {r}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => digest(category, selectedRounds)}
            disabled={loading || !category}
            className="px-6 py-2.5 bg-nhra-red text-white rounded-lg font-bold text-sm hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "Digesting…" : "Digest Qualifying"}
          </button>
          {breakdown && (
            <>
              <div className="inline-flex rounded-lg overflow-hidden border border-nhra-border">
                {(["breakdown", "ladders"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`px-4 py-2.5 text-sm font-bold ${
                      view === v ? "bg-nhra-darker text-white" : "bg-nhra-card text-gray-400 hover:text-white"
                    }`}
                  >
                    {v === "breakdown" ? "Class Breakdown" : `Ladders (${ladders.length})`}
                  </button>
                ))}
              </div>
              {view === "ladders" && (
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2.5 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg font-bold text-sm hover:text-white"
                >
                  Print Ladders
                </button>
              )}
              <button
                onClick={exportCsv}
                className="px-4 py-2.5 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg font-bold text-sm hover:text-white"
              >
                Export CSV
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-xl px-6 py-4 mb-6 text-red-400 text-sm font-medium print:hidden">
          {error}
        </div>
      )}

      {loading && !breakdown && (
        <div className="flex justify-center py-12 print:hidden">
          <div className="w-10 h-10 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {breakdown && (
        <>
          {/* Summary */}
          <div className="bg-nhra-card border border-nhra-border rounded-xl px-6 py-4 mb-6 flex items-center gap-6 flex-wrap print:hidden">
            <div>
              <p className="text-2xl font-bold text-white">{breakdown.totalCars}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Qualified cars</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-nhra-accent">{breakdown.classes.length}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Class ladders</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{breakdown.singles.length + breakdown.unresolved.length}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Singles</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{breakdown.combos.filter((c) => c.cars.length >= 2).length}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Combo ladders</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-xs text-gray-500">
                Rounds: {breakdown.roundsUsed.join(", ") || "—"}
              </p>
              {saving && <p className="text-xs text-yellow-500">Saving…</p>}
            </div>
          </div>

          {/* Needs attention */}
          {attentionCount > 0 && (
            <div className="bg-amber-500/10 border-2 border-amber-500/40 rounded-xl p-5 mb-6 print:hidden">
              <h2 className="text-amber-400 font-bold mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                Needs attention ({attentionCount})
              </h2>
              {breakdown.unresolved.length > 0 && (
                <div className="mb-4">
                  <p className="text-sm text-gray-300 mb-2">
                    These single-car classes don&apos;t designate a transmission — check the tech card (or ask Tech) and pick Stick or Auto:
                  </p>
                  <GroupTable cars={breakdown.unresolved} showClass onTrans={setTrans} onScratch={toggleScratch} />
                </div>
              )}
              {breakdown.noDesignation.length > 0 && (
                <div>
                  <p className="text-sm text-gray-300 mb-2">
                    No class designation on any run — fix the Class field on their runs (Runs page → edit):
                  </p>
                  <GroupTable cars={breakdown.noDesignation} onScratch={toggleScratch} />
                </div>
              )}
            </div>
          )}

          {/* ── Breakdown view ── */}
          {view === "breakdown" && (
            <div className="print:hidden">
              {breakdown.classes.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-sm font-bold text-nhra-accent uppercase tracking-wider mb-3">
                    Individual class ladders (2+ cars)
                  </h2>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {breakdown.classes.map((cls) => (
                      <div key={cls.designation} className="bg-nhra-card border border-nhra-border rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-white font-bold">{cls.designation}</h3>
                          <span className="px-2.5 py-0.5 bg-nhra-accent/15 text-nhra-accent text-xs font-bold rounded-full">
                            {cls.cars.length} cars
                          </span>
                        </div>
                        <GroupTable cars={cls.cars} onScratch={toggleScratch} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(breakdown.combos.length > 0 || breakdown.singles.length > 0) && (
                <div className="mb-8">
                  <h2 className="text-sm font-bold text-green-400 uppercase tracking-wider mb-3">
                    Combos (single-car classes)
                  </h2>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {breakdown.combos.map((combo) => (
                      <div key={combo.key} className="bg-nhra-card border border-nhra-border rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-white font-bold">{combo.label}</h3>
                          <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${
                            combo.cars.length >= 2 ? "bg-green-500/15 text-green-400" : "bg-gray-500/15 text-gray-400"
                          }`}>
                            {combo.cars.length >= 2 ? `${combo.cars.length} cars` : "single entry"}
                          </span>
                        </div>
                        <GroupTable
                          cars={combo.cars}
                          showClass
                          onScratch={toggleScratch}
                          onTrans={combo.key === "stick" || combo.key === "auto" ? setTrans : undefined}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {breakdown.excludedCars.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
                    Scratched (didn&apos;t make the call)
                  </h2>
                  <div className="bg-nhra-card border border-nhra-border rounded-xl p-4">
                    <GroupTable cars={breakdown.excludedCars} showClass onScratch={toggleScratch} />
                  </div>
                </div>
              )}

              {breakdown.totalCars === 0 && (
                <div className="bg-nhra-card border border-nhra-border rounded-xl px-6 py-10 text-center">
                  <p className="text-gray-400">No qualifying runs found for {breakdown.category} in the selected rounds</p>
                </div>
              )}
            </div>
          )}

          {/* ── Ladders view (also the print sheet) ── */}
          {view === "ladders" && (
            <div className="class-ladder-sheet">
              <div className="hidden print:block mb-4">
                <h1 className="text-xl font-bold">
                  {breakdown.category} — Class Eliminations · {live.config?.eventName || selectedEvent} {selectedSeason}
                </h1>
                <p className="text-xs">
                  Seeded vs individual class index from {breakdown.roundsUsed.join(", ")}. Generated by TiminData.
                </p>
              </div>
              {breakdown.unresolved.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl px-4 py-3 mb-4 text-amber-400 text-sm print:hidden">
                  {breakdown.unresolved.length} single{breakdown.unresolved.length !== 1 && "s"} still need a stick/auto call — those cars are not on any combo ladder yet.
                </div>
              )}
              {ladders.length === 0 && (
                <div className="bg-nhra-card border border-nhra-border rounded-xl px-6 py-10 text-center">
                  <p className="text-gray-400">No ladders yet — digest qualifying first</p>
                </div>
              )}
              {ladders.map((l) => (
                <LadderBracket key={l.title} title={l.title} entries={l.entries} showClass={l.showClass} />
              ))}
              {breakdown.combos.filter((c) => c.cars.length === 1).map((c) => (
                <div key={c.key} className="ladder-block bg-nhra-card border border-nhra-border rounded-xl p-4 mb-6">
                  <h3 className="text-white font-bold text-lg mb-1">{c.label}</h3>
                  <p className="text-sm text-gray-400">
                    Single entry — <span className="text-white font-semibold">#{c.cars[0].car_number} {c.cars[0].name}</span> ({c.cars[0].designation}) wins the combo unopposed.
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!breakdown && !loading && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl px-6 py-10 text-center print:hidden">
          <p className="text-gray-400 mb-1">
            {selectedEvent ? "Pick the Stock or Super Stock category and hit Digest Qualifying" : "Set up a live event on the Dashboard first"}
          </p>
          <p className="text-gray-500 text-sm">
            Classes with 2+ cars get their own ladder · singles roll into Stick/Auto/FS combos · seeded by under/over vs class index
          </p>
        </div>
      )}
    </div>
  );
}
