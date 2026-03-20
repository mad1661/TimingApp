"use client";

import Link from "next/link";

interface RunRow {
  timestamp: string | null;
  round: string | null;
  name: string | null;
  car_number: string | null;
  rt: number | null;
  ft1320: number | null;
  mph_1320: number | null;
  is_winner: number;
  lane: string | null;
  dial_in: number | null;
  mov: number | null;
}

interface Matchup {
  round: string;
  racers: RunRow[];
}

interface BracketViewProps {
  runs: RunRow[];
}

export default function BracketView({ runs }: BracketViewProps) {
  const rounds = [...new Set(runs.map((r) => r.round).filter(Boolean))].sort() as string[];

  if (rounds.length === 0) {
    return <div className="text-center text-gray-500 py-12">No elimination rounds found</div>;
  }

  const matchupsByRound = new Map<string, Matchup[]>();
  for (const round of rounds) {
    const roundRuns = runs.filter((r) => r.round === round);
    const byTimestamp = new Map<string, RunRow[]>();
    for (const run of roundRuns) {
      const ts = run.timestamp || "unknown";
      const group = byTimestamp.get(ts) || [];
      group.push(run);
      byTimestamp.set(ts, group);
    }
    const matchups: Matchup[] = Array.from(byTimestamp.values()).map((racers) => ({
      round,
      racers: racers.sort((a, b) => (a.lane === "L" ? -1 : 1)),
    }));
    matchupsByRound.set(round, matchups);
  }

  const isFourWide = runs.some((_, __, arr) => {
    const tsGroups = new Map<string, number>();
    arr.forEach((r) => {
      const ts = r.timestamp || "";
      tsGroups.set(ts, (tsGroups.get(ts) || 0) + 1);
    });
    return Array.from(tsGroups.values()).some((count) => count > 2);
  });

  return (
    <div className="overflow-x-auto">
      {isFourWide && (
        <div className="mb-4 px-4">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-medium rounded-lg">
            4-Wide Event
          </span>
        </div>
      )}
      <div className="flex gap-8 min-w-max p-4">
        {rounds.map((round) => {
          const matchups = matchupsByRound.get(round) || [];
          return (
            <div key={round} className="flex flex-col gap-4 min-w-[280px]">
              <div className="text-center mb-2">
                <span className="px-3 py-1 bg-nhra-red/20 text-nhra-red text-xs font-bold rounded-full uppercase tracking-wider">
                  Round {round.replace("E", "")}
                </span>
              </div>

              {matchups.map((matchup, idx) => (
                <MatchupCard key={idx} matchup={matchup} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MatchupCard({ matchup }: { matchup: Matchup }) {
  return (
    <div className="bg-nhra-card border border-nhra-border rounded-lg overflow-hidden">
      {matchup.racers.length === 0 ? (
        <div className="px-4 py-3 text-gray-600 text-sm">BYE</div>
      ) : (
        matchup.racers.map((racer, i) => (
          <div key={racer.name || i}>
            {i > 0 && <div className="border-t border-nhra-border" />}
            <RacerRow racer={racer} />
          </div>
        ))
      )}
    </div>
  );
}

function RacerRow({ racer }: { racer: RunRow }) {
  const isWinner = racer.is_winner === 1;

  return (
    <div className={`px-4 py-3 flex items-center justify-between transition-colors ${isWinner ? "bg-green-500/5" : ""}`}>
      <div className="flex items-center gap-3 min-w-0">
        {isWinner && <span className="w-1.5 h-1.5 bg-green-400 rounded-full shrink-0" />}
        <div className="min-w-0">
          <Link
            href={`/racer/${encodeURIComponent(racer.name || "")}`}
            className={`text-sm font-medium truncate block hover:text-nhra-accent transition-colors ${isWinner ? "text-white" : "text-gray-400"}`}
          >
            {racer.name}
          </Link>
          <p className="text-xs"><span className="text-nhra-accent font-bold">#{racer.car_number}</span> <span className="text-gray-600">| {racer.lane}</span></p>
        </div>
      </div>
      <div className="text-right shrink-0 ml-3">
        <p className={`text-sm font-mono ${isWinner ? "text-white font-medium" : "text-gray-400"}`}>
          {racer.ft1320?.toFixed(3) ?? "-"}
        </p>
        <p className="text-xs text-gray-600 font-mono">
          RT {racer.rt?.toFixed(3) ?? "-"}
        </p>
      </div>
    </div>
  );
}
