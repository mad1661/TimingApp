"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLiveData } from "@/components/LiveDataProvider";

interface NoShow {
  name: string;
  car_number: string;
  category: string;
  wonRound: string;
  missedRound: string;
}

interface DidNotRace {
  name: string;
  car_number: string;
  category: string;
  lastRound: string;
}

export default function NoShowsPage() {
  const live = useLiveData();
  const selectedEvent = live.config?.eventCode || "";
  const selectedSeason = live.config?.season || "";

  const [noShows, setNoShows] = useState<NoShow[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [noShowsLoading, setNoShowsLoading] = useState(false);
  const [noShowsSearched, setNoShowsSearched] = useState(false);
  const [manuallyFinished, setManuallyFinished] = useState(false);

  const [didNotRace, setDidNotRace] = useState<DidNotRace[]>([]);
  const [dnrLoading, setDnrLoading] = useState(false);
  const [dnrSearched, setDnrSearched] = useState(false);

  const [filtersLoading, setFiltersLoading] = useState(true);

  useEffect(() => {
    setFiltersLoading(false);
  }, [selectedEvent, selectedSeason]);

  async function searchNoShows() {
    if (!selectedEvent || !selectedSeason) return;
    setNoShowsLoading(true);
    setManuallyFinished(false);
    try {
      const res = await fetch(`/api/stats?type=noshows&event_code=${encodeURIComponent(selectedEvent)}&season=${encodeURIComponent(selectedSeason)}`);
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

  async function searchDidNotRace() {
    if (!selectedEvent || !selectedSeason) return;
    setDnrLoading(true);
    try {
      const res = await fetch(`/api/stats?type=didnotrace&event_code=${encodeURIComponent(selectedEvent)}&season=${encodeURIComponent(selectedSeason)}`);
      const data = await res.json();
      setDidNotRace(data.didNotRace || []);
      setDnrSearched(true);
    } catch (err) {
      console.error(err);
    } finally {
      setDnrLoading(false);
    }
  }

  const noShowsByCategory = noShows.reduce<Record<string, NoShow[]>>((acc, ns) => {
    (acc[ns.category] ??= []).push(ns);
    return acc;
  }, {});

  const dnrByCategory = didNotRace.reduce<Record<string, DidNotRace[]>>((acc, d) => {
    (acc[d.category] ??= []).push(d);
    return acc;
  }, {});

  function isCategoryRevealed(category: string): boolean {
    if (category !== activeCategory) return true;
    return manuallyFinished;
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
          Search No Shows
        </button>

        <button
          onClick={searchDidNotRace}
          disabled={dnrLoading || !selectedEvent}
          className="px-6 py-4 bg-red-700 text-white rounded-xl font-bold text-base hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3"
        >
          {dnrLoading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          Did Not Race in Eliminations
        </button>
      </div>

      {/* ===== NO SHOWS RESULTS ===== */}
      {noShowsLoading && (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {noShowsSearched && !noShowsLoading && noShows.length === 0 && (
        <div className="bg-nhra-card border-2 border-green-500/30 rounded-xl px-6 py-10 text-center mb-6">
          <div className="w-4 h-4 bg-green-500 rounded-full mx-auto mb-3" />
          <p className="text-green-400 font-bold text-lg mb-1">No Shows — All Clear</p>
          <p className="text-gray-500 text-sm">Every winner showed up for their next round</p>
        </div>
      )}

      {noShowsSearched && !noShowsLoading && noShows.length > 0 && (
        <div className="space-y-4 mb-8">
          <div className="bg-orange-500/10 border-2 border-orange-500/40 rounded-xl px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-orange-500 rounded-full animate-pulse" />
              <span className="text-orange-400 font-bold text-lg">
                {noShows.length} No Show{noShows.length !== 1 && "s"} Found
              </span>
            </div>
            <span className="text-gray-400 text-sm">
              across {Object.keys(noShowsByCategory).length} categor{Object.keys(noShowsByCategory).length !== 1 ? "ies" : "y"}
            </span>
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

      {/* ===== DID NOT RACE RESULTS ===== */}
      {dnrLoading && (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {dnrSearched && !dnrLoading && didNotRace.length === 0 && (
        <div className="bg-nhra-card border-2 border-green-500/30 rounded-xl px-6 py-10 text-center mb-6">
          <div className="w-4 h-4 bg-green-500 rounded-full mx-auto mb-3" />
          <p className="text-green-400 font-bold text-lg mb-1">Did Not Race — All Clear</p>
          <p className="text-gray-500 text-sm">Everyone who qualified made it to eliminations</p>
        </div>
      )}

      {dnrSearched && !dnrLoading && didNotRace.length > 0 && (
        <div className="space-y-4">
          <div className="bg-red-500/10 border-2 border-red-500/40 rounded-xl px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-red-500 rounded-full" />
              <span className="text-red-400 font-bold text-lg">
                {didNotRace.length} Racer{didNotRace.length !== 1 && "s"} Did Not Race in Eliminations
              </span>
            </div>
            <span className="text-gray-400 text-sm">
              across {Object.keys(dnrByCategory).length} categor{Object.keys(dnrByCategory).length !== 1 ? "ies" : "y"}
            </span>
          </div>

          {Object.entries(dnrByCategory).map(([category, racers]) => (
            <div key={category} className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
              <div className="px-6 py-3 bg-nhra-darker border-b border-nhra-border flex items-center justify-between">
                <h3 className="text-white font-bold">{category}</h3>
                <span className="px-2.5 py-0.5 bg-red-500/20 text-red-400 text-xs font-bold rounded-full">
                  {racers.length}
                </span>
              </div>
              <div className="divide-y divide-nhra-border">
                {racers.map((d) => (
                  <div key={`${d.name}-${d.category}`} className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-2.5 h-2.5 bg-red-500 rounded-full shrink-0" />
                      <div className="min-w-0">
                        <Link
                          href={`/racer/${encodeURIComponent(d.name)}`}
                          className="text-white font-semibold hover:text-nhra-accent transition-colors truncate block"
                        >
                          {d.name}
                        </Link>
                        <p className="text-sm text-nhra-accent font-bold">#{d.car_number}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <span className="inline-block px-3 py-1 bg-red-500/15 text-red-400 text-sm font-bold rounded-lg">
                        DID NOT RACE
                      </span>
                      <p className="text-xs text-gray-500 mt-1">
                        Last ran {d.lastRound}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
