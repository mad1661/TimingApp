"use client";

import { useRouter } from "next/navigation";
import { useLiveData } from "./LiveDataProvider";

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-nhra-border bg-nhra-darker px-2 py-0.5 text-[0.7rem] font-medium text-gray-400">
      {children}
    </span>
  );
}

export default function EventBanner() {
  const live = useLiveData();
  const router = useRouter();

  if (!live.config) return null;

  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl border border-nhra-border bg-nhra-card">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-linear-to-b from-nhra-red via-nhra-red/70 to-nhra-red/20" />
      <div className="pointer-events-none absolute -left-20 -top-24 h-52 w-72 rounded-full bg-nhra-red/10 blur-3xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4 pl-5 pr-4 sm:pl-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-nhra-red/15 ring-1 ring-inset ring-nhra-red/30">
            <svg className="w-5 h-5 text-nhra-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold leading-tight text-white text-balance">{live.config.eventName}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <MetaChip>{live.config.season} Season</MetaChip>
              <MetaChip>{live.config.dateFilter ? "Filtered to one day" : "All days"}</MetaChip>
              <MetaChip>{live.config.intervalSeconds > 0 ? `Auto every ${live.config.intervalSeconds}s` : "Manual refresh"}</MetaChip>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {live.isActive && live.config.intervalSeconds > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-green-500/25 bg-green-500/10 px-2.5 py-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
              </span>
              <span className="text-[0.7rem] font-bold tracking-wider text-green-400">AUTO</span>
            </div>
          )}
          <button
            onClick={() => router.push("/setup")}
            className="flex items-center gap-1.5 rounded-lg border border-nhra-border bg-nhra-darker px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Switch Event
          </button>
          <button
            onClick={() => live.fetchNow()}
            disabled={live.isFetching}
            className="flex items-center gap-2 rounded-lg bg-nhra-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-nhra-red/85 disabled:opacity-50"
          >
            {live.isFetching ? (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {live.isFetching ? "Fetching..." : "Refresh Data"}
          </button>
        </div>
      </div>
      {(live.lastFetch || live.lastError) && (
        <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-nhra-border/60 px-5 py-2 text-xs sm:pl-6">
          {live.lastFetch && (
            <p className="text-gray-500">
              Last fetch: {live.lastFetch.toLocaleTimeString()}
              {live.lastResult && (
                <span className="ml-2">
                  {live.lastResult.totalParsed} parsed
                  {live.lastResult.inserted > 0 && <span className="text-green-400 ml-1">+{live.lastResult.inserted} new</span>}
                </span>
              )}
            </p>
          )}
          {live.lastError && <p className="text-red-400">{live.lastError}</p>}
          {live.totalNewRuns > 0 && (
            <p className="text-green-400 font-medium">{live.totalNewRuns} new runs this session</p>
          )}
        </div>
      )}
    </div>
  );
}
