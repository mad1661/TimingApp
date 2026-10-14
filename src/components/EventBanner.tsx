"use client";

import { useRouter } from "next/navigation";
import { useLiveData } from "./LiveDataProvider";

export default function EventBanner() {
  const live = useLiveData();
  const router = useRouter();

  if (!live.config) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-nhra-border bg-nhra-card">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-nhra-red/10 text-nhra-red ring-1 ring-inset ring-nhra-red/25">
            <svg className="h-[1.05rem] w-[1.05rem]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-[1.05rem] font-semibold leading-snug tracking-tight text-white text-balance">{live.config.eventName}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="chip">{live.config.season} Season</span>
              <span className="chip">{live.config.dateFilter ? "Filtered to one day" : "All days"}</span>
              <span className="chip">{live.config.intervalSeconds > 0 ? `Auto every ${live.config.intervalSeconds}s` : "Manual refresh"}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {live.isActive && live.config.intervalSeconds > 0 && (
            <span className="chip hidden sm:inline-flex h-7 gap-2 border-green-500/25 bg-green-500/10 px-2.5 font-semibold tracking-wider text-green-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
              </span>
              AUTO
            </span>
          )}
          <button onClick={() => router.push("/setup")} className="btn btn-secondary">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Switch Event
          </button>
          <button onClick={() => live.fetchNow()} disabled={live.isFetching} className="btn btn-primary">
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
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-nhra-border bg-[var(--ui-head-bg)] px-4 py-2 text-xs sm:px-5">
          {live.lastFetch && (
            <p className="tabular-nums text-gray-500">
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
