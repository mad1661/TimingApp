"use client";

import Link from "next/link";
import { groupRunsByTimestamp } from "@/lib/timestamp-utils";

interface RunRow {
  timestamp: string | null;
  round: string | null;
  name: string | null;
  car_number: string | null;
  rt: number | null;
  ft1320: number | null;
  mph_1320: number | null;
  is_winner: number;
  result?: string | null;
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
    const byTimestamp = groupRunsByTimestamp(roundRuns);
    const matchups: Matchup[] = Array.from(byTimestamp.values()).map((racers) => ({
      round,
      racers: racers.sort((a, b) => {
        const la = a.lane || "";
        const lb = b.lane || "";
        if (la === "L") return -1;
        if (lb === "L") return 1;
        if (la === "R") return 1;
        if (lb === "R") return -1;
        return la.localeCompare(lb);
      }),
    }));
    matchupsByRound.set(round, matchups);
  }

  const isFourWide = Array.from(matchupsByRound.values()).some((matchups) =>
    matchups.some((m) => m.racers.length > 2)
  );

  return (
    <div className="overflow-x-auto">
      {isFourWide && (
        <div className="mb-4 px-4">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-nhra-red/10 border border-nhra-red/20 text-nhra-red text-xs font-medium rounded-lg">
            4-Wide Format
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
  const r = racer.result?.trim().toUpperCase();
  const isWinner = r === "W" || (!r && racer.is_winner === 1);
  const isRunnerUp = r === "R";
  const highlight = isWinner || isRunnerUp;
  const bgClass = isWinner ? "bg-green-500/5" : isRunnerUp ? "bg-blue-500/5" : "";

  let badge: React.ReactNode = null;
  if (isWinner) badge = <span className="text-[9px] font-bold bg-green-600 text-white px-1.5 py-0.5 rounded">W</span>;
  else if (isRunnerUp) badge = <span className="text-[9px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded">R</span>;
  else if (r === "3") badge = <span className="text-[9px] font-bold bg-gray-600 text-white px-1.5 py-0.5 rounded">3</span>;
  else if (r === "4") badge = <span className="text-[9px] font-bold bg-gray-600 text-white px-1.5 py-0.5 rounded">4</span>;

  return (
    <div className={`px-4 py-3 flex items-center justify-between transition-colors ${bgClass}`}>
      <div className="flex items-center gap-3 min-w-0">
        {badge && <div className="shrink-0">{badge}</div>}
        <div className="min-w-0">
          <Link
            href={`/racer/${encodeURIComponent(racer.name || "")}`}
            className={`text-sm font-medium truncate block hover:text-nhra-accent transition-colors ${highlight ? "text-white" : "text-gray-400"}`}
          >
            {racer.name}
          </Link>
          <p className="text-xs"><span className="text-nhra-accent font-bold">#{racer.car_number}</span> <span className="text-gray-600">| {racer.lane}</span></p>
        </div>
      </div>
      <div className="text-right shrink-0 ml-3">
        <p className={`text-sm font-mono ${highlight ? "text-white font-medium" : "text-gray-400"}`}>
          {racer.ft1320?.toFixed(3) ?? "-"}
        </p>
        <p className="text-xs text-gray-600 font-mono">
          RT {racer.rt?.toFixed(3) ?? "-"}
        </p>
      </div>
    </div>
  );
}
