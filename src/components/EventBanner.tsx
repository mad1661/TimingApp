"use client";

import { useRouter } from "next/navigation";
import { useLiveData } from "./LiveDataProvider";

export default function EventBanner() {
  const live = useLiveData();
  const router = useRouter();

  if (!live.config) return null;

  return (
    <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-nhra-red/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-nhra-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">{live.config.eventName}</h2>
            <p className="text-sm text-gray-400">
              {live.config.season} Season
              {live.config.dateFilter ? " \u2022 Filtered to one day" : " \u2022 All days"}
              {live.config.intervalSeconds > 0 ? ` \u2022 Auto every ${live.config.intervalSeconds}s` : " \u2022 Manual refresh"}
            </p>
          </div>
          <button
            onClick={() => router.push("/setup")}
            className="ml-2 px-3 py-1.5 bg-nhra-darker border border-nhra-border text-gray-400 rounded-lg text-xs font-medium hover:text-white hover:border-gray-500 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Switch Event
          </button>
        </div>
        <div className="flex items-center gap-3">
          {live.isActive && live.config.intervalSeconds > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-lg">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span className="text-xs text-green-400 font-medium">AUTO</span>
            </div>
          )}
          <button
            onClick={() => live.fetchNow()}
            disabled={live.isFetching}
            className="px-4 py-2 bg-nhra-red/20 border border-nhra-red/30 text-nhra-red rounded-lg text-sm font-medium hover:bg-nhra-red/30 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {live.isFetching ? (
              <div className="w-3.5 h-3.5 border-2 border-nhra-red border-t-transparent rounded-full animate-spin" />
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
        <div className="mt-3 pt-3 border-t border-nhra-border/50 flex items-center justify-between text-xs">
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
