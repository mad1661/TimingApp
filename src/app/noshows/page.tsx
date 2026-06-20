"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveData } from "@/components/LiveDataProvider";

interface NoShow {
  name: string;
  car_number: string;
  category: string;
  wonRound: string;
  missedRound: string;
}

interface MissingEntry {
  name: string;
  car_number: string;
  category: string;
  lastRound: string | null;
  source: "qualifying" | "tech_card" | "both";
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const escape = (v: string): string => {
    if (v == null) return "";
    if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = [
    header.map(escape).join(","),
    ...rows.map((r) => r.map(escape).join(",")),
  ];
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

export default function NoShowsPage() {
  const live = useLiveData();
  const selectedEvent = live.config?.eventCode || "";
  const selectedSeason = live.config?.season || "";
  const selectedEventName = live.config?.eventName || "";

  const [noShows, setNoShows] = useState<NoShow[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [noShowsLoading, setNoShowsLoading] = useState(false);
  const [noShowsSearched, setNoShowsSearched] = useState(false);
  const [manuallyFinished, setManuallyFinished] = useState(false);

  const [missing, setMissing] = useState<MissingEntry[]>([]);
  const [missingLoading, setMissingLoading] = useState(false);
  const [missingSearched, setMissingSearched] = useState(false);

  // Categories the user has chosen to HIDE. Persisted per-event in
  // localStorage so the same toggles stick when they come back.
  const hideKey = `noshows_hidden_categories_${selectedEvent}_${selectedSeason}`;
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (typeof window === "undefined" || !selectedEvent) return;
    try {
      const raw = window.localStorage.getItem(hideKey);
      if (raw) setHiddenCategories(new Set(JSON.parse(raw)));
      else setHiddenCategories(new Set());
    } catch {
      setHiddenCategories(new Set());
    }
  }, [hideKey, selectedEvent]);
  function toggleHidden(cat: string) {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(hideKey, JSON.stringify(Array.from(next)));
        }
      } catch {}
      return next;
    });
  }

  async function searchNoShows() {
    if (!selectedEvent || !selectedSeason) return;
    setNoShowsLoading(true);
    setManuallyFinished(false);
    try {
      const res = await fetch(`/api/stats?type=noshows&event_code=${encodeURIComponent(selectedEvent)}&season=${encodeURIComponent(selectedSeason)}`, { cache: "no-store" });
      const data = await res.json();
      setNoShows(data.noShows || []);
      setActiveCategory(data.activeCategory || null);
      setNoShowsSearched(true);
    } catch (err) {
      console.error(err);
    } finally {
      setNoShowsLoading(false);
    }
  }

  async function searchMissing() {
    if (!selectedEvent || !selectedSeason) return;
    setMissingLoading(true);
    try {
      const qs = `event_code=${encodeURIComponent(selectedEvent)}&season=${encodeURIComponent(selectedSeason)}&event_name=${encodeURIComponent(selectedEventName)}`;
      const res = await fetch(`/api/stats?type=missing-elims&${qs}`, { cache: "no-store" });
      const data = await res.json();
      setMissing(data.missing || []);
      setMissingSearched(true);
    } catch (err) {
      console.error(err);
    } finally {
      setMissingLoading(false);
    }
  }

  // Re-run whichever searches the user has already triggered when new live
  // data arrives, so the displayed lists refresh without a page reload.
  useEffect(() => {
    if (noShowsSearched) searchNoShows();
    if (missingSearched) searchMissing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.dataVersion]);

  // Pull every category that shows up across both result sets so the
  // checkbox bar is stable regardless of which sections are populated.
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const n of noShows) set.add(n.category);
    for (const m of missing) set.add(m.category);
    return Array.from(set).sort();
  }, [noShows, missing]);

  const visibleNoShows = noShows.filter((n) => !hiddenCategories.has(n.category));
  const visibleMissing = missing.filter((m) => !hiddenCategories.has(m.category));
  const visibleQualified = visibleMissing.filter(
    (m) => m.source === "qualifying" || m.source === "both",
  );
  const visibleTechOnly = visibleMissing.filter((m) => m.source === "tech_card");

  const noShowsByCategory = visibleNoShows.reduce<Record<string, NoShow[]>>((acc, ns) => {
    (acc[ns.category] ??= []).push(ns);
    return acc;
  }, {});
  const qualifiedByCategory = visibleQualified.reduce<Record<string, MissingEntry[]>>((acc, d) => {
    (acc[d.category] ??= []).push(d);
    return acc;
  }, {});
  const techOnlyByCategory = visibleTechOnly.reduce<Record<string, MissingEntry[]>>((acc, d) => {
    (acc[d.category] ??= []).push(d);
    return acc;
  }, {});

  function isCategoryRevealed(category: string): boolean {
    if (category !== activeCategory) return true;
    return manuallyFinished;
  }

  function exportNoShowsCsv() {
    downloadCsv(
      `no-shows-${selectedEvent}-${selectedSeason}.csv`,
      ["Category", "Car #", "Name", "Won Round", "Missed Round"],
      visibleNoShows.map((n) => [n.category, n.car_number, n.name, n.wonRound, n.missedRound]),
    );
  }
  function exportQualifiedCsv() {
    downloadCsv(
      `did-not-race-elims-${selectedEvent}-${selectedSeason}.csv`,
      ["Category", "Car #", "Name", "Last Round"],
      visibleQualified.map((m) => [m.category, m.car_number, m.name, m.lastRound || ""]),
    );
  }
  function exportTechOnlyCsv() {
    downloadCsv(
      `never-showed-${selectedEvent}-${selectedSeason}.csv`,
      ["Category", "Car #", "Name"],
      visibleTechOnly.map((m) => [m.category, m.car_number, m.name]),
    );
  }
  function exportAllMissingCsv() {
    downloadCsv(
      `missing-from-elims-${selectedEvent}-${selectedSeason}.csv`,
      ["Category", "Car #", "Name", "Status", "Last Round"],
      visibleMissing.map((m) => [
        m.category,
        m.car_number,
        m.name,
        m.source === "tech_card" ? "Never Showed" : "Qualified, Missed Elims",
        m.lastRound || "",
      ]),
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">No Shows</h1>
        <p className="text-gray-400">Track racers who didn&apos;t show up when they should have</p>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <button
          onClick={searchNoShows}
          disabled={noShowsLoading || !selectedEvent}
          className="px-6 py-4 bg-orange-600 text-white rounded-xl font-bold text-base hover:bg-orange-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3"
        >
          {noShowsLoading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          )}
          Search No Shows (Won → Missed)
        </button>

        <button
          onClick={searchMissing}
          disabled={missingLoading || !selectedEvent}
          className="px-6 py-4 bg-red-700 text-white rounded-xl font-bold text-base hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3"
        >
          {missingLoading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          Missing From Eliminations (Q/T or Tech Cards)
        </button>
      </div>

      {/* Category Filter */}
      {allCategories.length > 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-white">Show categories</h3>
            <div className="flex gap-2 text-xs">
              <button
                onClick={() => setHiddenCategories(new Set())}
                className="px-3 py-1 bg-nhra-darker border border-nhra-border text-gray-300 rounded hover:text-white"
              >
                Show all
              </button>
              <button
                onClick={() => setHiddenCategories(new Set(allCategories))}
                className="px-3 py-1 bg-nhra-darker border border-nhra-border text-gray-300 rounded hover:text-white"
              >
                Hide all
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {allCategories.map((cat) => {
              const hidden = hiddenCategories.has(cat);
              return (
                <label
                  key={cat}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs cursor-pointer border transition-colors ${
                    hidden
                      ? "bg-nhra-darker border-nhra-border text-gray-500"
                      : "bg-nhra-red/10 border-nhra-red/40 text-white"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!hidden}
                    onChange={() => toggleHidden(cat)}
                    className="accent-nhra-red"
                  />
                  {cat}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== NO SHOWS RESULTS ===== */}
      {noShowsLoading && (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {noShowsSearched && !noShowsLoading && visibleNoShows.length === 0 && (
        <div className="bg-nhra-card border-2 border-green-500/30 rounded-xl px-6 py-10 text-center mb-6">
          <div className="w-4 h-4 bg-green-500 rounded-full mx-auto mb-3" />
          <p className="text-green-400 font-bold text-lg mb-1">No Shows — All Clear</p>
          <p className="text-gray-500 text-sm">Every winner showed up for their next round (in the visible categories)</p>
        </div>
      )}

      {noShowsSearched && !noShowsLoading && visibleNoShows.length > 0 && (
        <div className="space-y-4 mb-8">
          <div className="bg-orange-500/10 border-2 border-orange-500/40 rounded-xl px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-orange-500 rounded-full animate-pulse" />
              <span className="text-orange-400 font-bold text-lg">
                {visibleNoShows.length} No Show{visibleNoShows.length !== 1 && "s"} Found
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-400 text-sm">
                across {Object.keys(noShowsByCategory).length} categor{Object.keys(noShowsByCategory).length !== 1 ? "ies" : "y"}
              </span>
              <button
                onClick={exportNoShowsCsv}
                className="px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded hover:bg-orange-500"
              >
                Export CSV
              </button>
            </div>
          </div>

          {Object.entries(noShowsByCategory).map(([category, catNoShows]) => {
            const revealed = isCategoryRevealed(category);
            const isActive = category === activeCategory;

            return (
              <div key={category} className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
                <div className="px-6 py-3 bg-nhra-darker border-b border-nhra-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-white font-bold">{category}</h3>
                    <span className="px-2.5 py-0.5 bg-orange-500/20 text-orange-400 text-xs font-bold rounded-full">
                      {catNoShows.length} no show{catNoShows.length !== 1 && "s"}
                    </span>
                  </div>
                  {isActive && !manuallyFinished ? (
                    <span className="text-xs text-yellow-500 uppercase tracking-wider font-medium flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse" />
                      Running
                    </span>
                  ) : (
                    <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Complete</span>
                  )}
                </div>

                {revealed ? (
                  <div className="divide-y divide-nhra-border">
                    {catNoShows.map((ns) => (
                      <div key={`${ns.name}-${ns.missedRound}`} className="px-6 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-2.5 h-2.5 bg-orange-500 rounded-full shrink-0" />
                          <div className="min-w-0">
                            <Link
                              href={`/racer/${encodeURIComponent(ns.name)}`}
                              className="text-white font-semibold hover:text-nhra-accent transition-colors truncate block"
                            >
                              {ns.name}
                            </Link>
                            <p className="text-sm text-nhra-accent font-bold">#{ns.car_number}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <span className="inline-block px-3 py-1 bg-orange-500/15 text-orange-400 text-sm font-bold rounded-lg">
                            NO SHOW
                          </span>
                          <p className="text-xs text-gray-500 mt-1">
                            Won {ns.wonRound.replace("E", "R")} → missed {ns.missedRound.replace("E", "R")}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-6 py-6 text-center">
                    <p className="text-gray-500 text-sm mb-4">
                      {catNoShows.length} potential no show{catNoShows.length !== 1 && "s"} detected — finish running this class to reveal
                    </p>
                    <button
                      onClick={() => setManuallyFinished(true)}
                      className="px-6 py-2.5 bg-orange-600 text-white rounded-lg font-bold text-sm hover:bg-orange-500 transition-colors"
                    >
                      Finish Class &amp; Show No Shows
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== MISSING FROM ELIMS RESULTS ===== */}
      {missingLoading && (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {missingSearched && !missingLoading && visibleMissing.length === 0 && (
        <div className="bg-nhra-card border-2 border-green-500/30 rounded-xl px-6 py-10 text-center mb-6">
          <div className="w-4 h-4 bg-green-500 rounded-full mx-auto mb-3" />
          <p className="text-green-400 font-bold text-lg mb-1">Missing From Elims — All Clear</p>
          <p className="text-gray-500 text-sm">Every entered car (with a tech card or qualifying run) made it to eliminations</p>
        </div>
      )}

      {missingSearched && !missingLoading && visibleMissing.length > 0 && (
        <>
          <div className="bg-red-500/10 border-2 border-red-500/40 rounded-xl px-6 py-4 flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-red-500 rounded-full" />
              <span className="text-red-400 font-bold text-lg">
                {visibleMissing.length} Missing From Eliminations
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-400 text-sm">
                {visibleQualified.length} qualified · {visibleTechOnly.length} never showed
              </span>
              <button
                onClick={exportAllMissingCsv}
                className="px-3 py-1.5 bg-red-700 text-white text-xs font-medium rounded hover:bg-red-600"
              >
                Export CSV
              </button>
            </div>
          </div>

          {Object.keys(qualifiedByCategory).length > 0 && (
            <div className="space-y-4 mb-8">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-sm font-bold text-amber-400 uppercase tracking-wider">
                  Qualified but skipped Eliminations
                </h2>
                <button
                  onClick={exportQualifiedCsv}
                  className="px-3 py-1 bg-amber-600 text-white text-xs font-medium rounded hover:bg-amber-500"
                >
                  Export CSV
                </button>
              </div>
              {Object.entries(qualifiedByCategory).map(([category, racers]) => (
                <div key={category} className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
                  <div className="px-6 py-3 bg-nhra-darker border-b border-nhra-border flex items-center justify-between">
                    <h3 className="text-white font-bold">{category}</h3>
                    <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-400 text-xs font-bold rounded-full">
                      {racers.length}
                    </span>
                  </div>
                  <div className="divide-y divide-nhra-border">
                    {racers.map((d) => (
                      <div key={`${d.name}-${d.car_number}`} className="px-6 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-2.5 h-2.5 bg-amber-500 rounded-full shrink-0" />
                          <div className="min-w-0">
                            <Link
                              href={`/racer/${encodeURIComponent(d.name)}`}
                              className="text-white font-semibold hover:text-nhra-accent transition-colors truncate block"
                            >
                              {d.name || "(no name)"}
                            </Link>
                            <p className="text-sm text-nhra-accent font-bold">#{d.car_number}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <span className="inline-block px-3 py-1 bg-amber-500/15 text-amber-400 text-sm font-bold rounded-lg">
                            DNQ’d
                          </span>
                          <p className="text-xs text-gray-500 mt-1">
                            Last ran {d.lastRound || "—"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {Object.keys(techOnlyByCategory).length > 0 && (
            <div className="space-y-4 mb-8">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-sm font-bold text-red-400 uppercase tracking-wider">
                  Tech card on file — never staged
                </h2>
                <button
                  onClick={exportTechOnlyCsv}
                  className="px-3 py-1 bg-red-700 text-white text-xs font-medium rounded hover:bg-red-600"
                >
                  Export CSV
                </button>
              </div>
              {Object.entries(techOnlyByCategory).map(([category, racers]) => (
                <div key={category} className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
                  <div className="px-6 py-3 bg-nhra-darker border-b border-nhra-border flex items-center justify-between">
                    <h3 className="text-white font-bold">{category}</h3>
                    <span className="px-2.5 py-0.5 bg-red-500/20 text-red-400 text-xs font-bold rounded-full">
                      {racers.length}
                    </span>
                  </div>
                  <div className="divide-y divide-nhra-border">
                    {racers.map((d) => (
                      <div key={`${d.name}-${d.car_number}`} className="px-6 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-2.5 h-2.5 bg-red-500 rounded-full shrink-0" />
                          <div className="min-w-0">
                            <p className="text-white font-semibold truncate">
                              {d.name || "(no name)"}
                            </p>
                            <p className="text-sm text-nhra-accent font-bold">#{d.car_number}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <span className="inline-block px-3 py-1 bg-red-500/15 text-red-400 text-sm font-bold rounded-lg">
                            NEVER SHOWED
                          </span>
                          <p className="text-xs text-gray-500 mt-1">No runs at this event</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
