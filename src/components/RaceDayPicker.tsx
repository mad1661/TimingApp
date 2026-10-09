"use client";

import { formatRaceDay } from "@/lib/race-day";

export interface RaceDayOption {
  day: string;
  runs: number;
}

/** "latest" (the default), "all", or one race day as "YYYY-MM-DD". */
export type RaceDayChoice = string;

const ACCENTS = {
  red: "bg-nhra-red/20 border-nhra-red/50 text-nhra-red",
  green: "bg-green-600/20 border-green-500/50 text-green-400",
  blue: "bg-blue-500/20 border-blue-500/40 text-blue-400",
} as const;

/**
 * Race-day filter for the per-day reports. "Latest Day" lets the server pick
 * the most recent day the report's rounds ran. `applied` is the day the results
 * on screen cover (null = all days, undefined = nothing searched yet), so which
 * day "latest" landed on is never a guess.
 */
export default function RaceDayPicker({
  days,
  value,
  onChange,
  applied,
  accent = "red",
}: {
  days: RaceDayOption[];
  value: RaceDayChoice;
  onChange: (choice: RaceDayChoice) => void;
  applied?: string | null;
  accent?: keyof typeof ACCENTS;
}) {
  if (days.length === 0) return null;

  const chip = (active: boolean) =>
    `px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
      active
        ? ACCENTS[accent]
        : "bg-nhra-darker border-nhra-border text-gray-400 hover:text-white hover:border-nhra-accent/30"
    }`;

  return (
    <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white">Race Day</h2>
        {applied !== undefined && (
          <span className="text-xs text-gray-400">Showing {applied ? formatRaceDay(applied) : "all days"}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <button onClick={() => onChange("latest")} className={chip(value === "latest")}>
          Latest Day
        </button>
        <button onClick={() => onChange("all")} className={chip(value === "all")}>
          All Days
        </button>
        <div className="w-px bg-nhra-border mx-1" />
        {days.map((d) => (
          <button
            key={d.day}
            onClick={() => onChange(d.day)}
            className={chip(value === d.day)}
            title={`${d.runs.toLocaleString()} passes on file`}
          >
            {formatRaceDay(d.day)}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-3">
        One event can hold passes from other days under the same round names — a previous weekend or a midweek
        session. Latest Day uses the most recent day these rounds ran.
      </p>
    </div>
  );
}
