"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useLiveData } from "./LiveDataProvider";
import ThemeToggle from "./ThemeToggle";
import BrandMark from "./BrandMark";
import { APP_VERSION } from "@/lib/version";

const NAV_SECTIONS = ["Race Day", "Eliminations", "Insights", "Points & Files", "Racers", "Data"] as const;
type NavSection = (typeof NAV_SECTIONS)[number];

const NAV_ITEMS: { href: string; label: string; section: NavSection; icon: string }[] = [
  { href: "/", label: "Dashboard", section: "Race Day", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { href: "/search", label: "Search", section: "Race Day", icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
  { href: "/runs", label: "Runs", section: "Race Day", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { href: "/schedule", label: "Schedule", section: "Race Day", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { href: "/schedule-builder", label: "Plan", section: "Race Day", icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
  { href: "/timeslip", label: "Timeslip", section: "Race Day", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { href: "/round-print", label: "Round Log Print", section: "Race Day", icon: "M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" },
  { href: "/brackets", label: "Brackets", section: "Eliminations", icon: "M4 6h16M4 12h8m-8 6h16" },
  { href: "/ladder-builder", label: "Ladder Builder", section: "Eliminations", icon: "M4 4h6v6H4zM4 14h6v6H4zM14 4h6v16h-6zM10 7h4M10 17h4" },
  { href: "/class-elims", label: "Class Elims", section: "Eliminations", icon: "M3 5h8M3 9h8M3 13h8M3 17h8M15 7h6M15 12h6M15 17h6M11 5v4M11 13v4" },
  { href: "/qualifying", label: "Qualifying", section: "Eliminations", icon: "M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" },
  { href: "/stats", label: "Statistics", section: "Insights", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { href: "/best-losing-package", label: "Best Losing Package", section: "Insights", icon: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" },
  { href: "/perfect-rt", label: "Perfect RT", section: "Insights", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { href: "/dead-on", label: "Dead On", section: "Insights", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
  { href: "/noshows", label: "No Shows", section: "Insights", icon: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" },
  { href: "/doubles", label: "Doubled Up", section: "Insights", icon: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" },
  { href: "/edata", label: "EData", section: "Points & Files", icon: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" },
  { href: "/et-finals", label: "ET Finals Points", section: "Points & Files", icon: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" },
  { href: "/tech-cards", label: "Tech Cards", section: "Racers", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { href: "/racer-profile", label: "Racer Profile", section: "Racers", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
  { href: "/driver-search", label: "Driver Search", section: "Racers", icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m-3-3h6" },
  { href: "/contacts", label: "Contacts & Mailing", section: "Racers", icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
  { href: "/backfill", label: "Backfill History", section: "Data", icon: "M4 7v10c0 2 1.5 3 4 3h8c2.5 0 4-1 4-3V7M4 7c0-2 1.5-3 4-3h8c2.5 0 4 1 4 3M4 7c0 2 1.5 3 4 3h8c2.5 0 4-1 4-3M12 12v6m0 0l-2.5-2.5M12 18l2.5-2.5" },
  { href: "/tech-card-backfill", label: "Tech Card Backfill", section: "Data", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2zM4 7v10c0 2 1.5 3 4 3" },
  { href: "/raw", label: "Raw Data", section: "Data", icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" },
];

function LiveDot({ fetching }: { fetching: boolean }) {
  const color = fetching ? "bg-yellow-400" : "bg-green-400";
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${color}`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const live = useLiveData();
  const source = live.config?.dataSource ?? "scraper";

  return (
    <>
      <header className="lg:hidden sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-nhra-border bg-nhra-dark/85 light:bg-white/85 px-3 backdrop-blur-md print:hidden">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-nhra-border bg-nhra-card text-gray-300"
          aria-label="Toggle navigation"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mobileOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
          </svg>
        </button>
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <BrandMark size="sm" />
          <span className="truncate font-display text-lg font-bold tracking-wide text-white">Timing Data</span>
        </Link>
        {live.config && live.isActive && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-green-500/25 bg-green-500/10 px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wider text-green-400">
            <LiveDot fetching={live.isFetching} />
            Live
          </span>
        )}
      </header>

      <nav className={`fixed top-0 left-0 h-full w-64 bg-nhra-dark border-r border-nhra-border z-40 transition-transform duration-200 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 flex flex-col`}>
        <div className="flex items-center justify-between gap-2 px-4 pt-5 pb-4">
          <Link href="/" className="flex min-w-0 items-center gap-3" onClick={() => setMobileOpen(false)}>
            <BrandMark />
            <div className="min-w-0">
              <p className="font-display text-[1.3rem] font-bold leading-none tracking-wide text-white">Timing Data</p>
              <p className="mt-1 truncate text-[0.7rem] font-medium text-gray-500">Rice is Great All Year</p>
            </div>
          </Link>
          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
            <button
              onClick={() => setMobileOpen(false)}
              className="lg:hidden flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-nhra-card hover:text-white"
              aria-label="Close navigation"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto border-t border-nhra-border/60 px-3 pb-7 [mask-image:linear-gradient(to_bottom,#000_calc(100%-1.75rem),transparent)]">
          {NAV_SECTIONS.map((section) => (
            <div key={section} className="pt-4">
              <p className="px-3 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-gray-500">{section}</p>
              <div className="space-y-0.5">
                {NAV_ITEMS.filter((item) => item.section === section).map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={isActive ? "page" : undefined}
                      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 lg:py-1.5 text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-nhra-red/12 text-white"
                          : "text-gray-400 hover:bg-nhra-card hover:text-white"
                      }`}
                    >
                      {isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-nhra-red" />}
                      <svg
                        className={`h-[1.15rem] w-[1.15rem] shrink-0 transition-opacity ${isActive ? "text-nhra-red" : "opacity-70 group-hover:opacity-100"}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d={item.icon} />
                      </svg>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Live Status + Change Event Footer */}
        <div className="border-t border-nhra-border p-3 space-y-2">
          {live.config ? (
            <div className="rounded-xl border border-nhra-border bg-nhra-card p-2.5 space-y-2">
              <div className="flex items-center gap-2 px-0.5">
                {live.isActive ? (
                  <>
                    <LiveDot fetching={live.isFetching} />
                    <span className="text-[0.68rem] font-bold uppercase tracking-wider text-white">Live</span>
                  </>
                ) : (
                  <span className="text-[0.68rem] font-bold uppercase tracking-wider text-gray-500">Event</span>
                )}
                {live.lastFetch && (
                  <span className="ml-auto truncate text-[0.68rem] text-gray-500">
                    Last {live.lastFetch.toLocaleTimeString()}
                    {live.lastResult && live.lastResult.inserted > 0 && (
                      <span className="text-green-400 ml-1">+{live.lastResult.inserted}</span>
                    )}
                  </span>
                )}
              </div>
              <p className="px-0.5 text-xs font-medium leading-snug text-gray-300 line-clamp-2" title={live.config.eventName || live.config.eventCode}>
                {live.config.eventName || live.config.eventCode}
              </p>
              {live.lastError && (
                <p className="px-0.5 text-xs text-red-400 truncate">{live.lastError}</p>
              )}
              {live.totalNewRuns > 0 && (
                <p className="px-0.5 text-xs text-green-400">{live.totalNewRuns} new runs this session</p>
              )}
              {/* Data source: getresults scraper (default), official API, or
                  EData files. EData turns polling off entirely. */}
              <div className="flex items-center gap-0.5 rounded-lg bg-nhra-darker border border-nhra-border p-0.5">
                <span className="text-[0.6rem] font-semibold uppercase tracking-wider text-gray-500 px-1.5 shrink-0">Source</span>
                {(["scraper", "api", "edata"] as const).map((src) => {
                  const active = source === src;
                  return (
                    <button
                      key={src}
                      onClick={() => live.setDataSource(src)}
                      className={`flex-1 px-1.5 py-1 rounded-md text-[0.7rem] font-semibold transition-colors ${
                        active ? "bg-nhra-red text-white" : "text-gray-400 hover:text-white"
                      }`}
                    >
                      {src === "api" ? "API" : src === "edata" ? "EData" : "getresults"}
                    </button>
                  );
                })}
              </div>
              {source === "edata" && (
                <Link
                  href="/edata"
                  className="block text-xs text-yellow-500 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-2 py-1.5 leading-snug hover:bg-yellow-500/20"
                >
                  getresults polling is off. Runs come from the EData files you
                  upload — open EData.
                </Link>
              )}
              <button
                onClick={() => live.fetchNow()}
                disabled={live.isFetching || source === "edata"}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-nhra-red hover:bg-nhra-red/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className={`w-4 h-4 ${live.isFetching ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {live.isFetching ? "Fetching..." : "Refresh Data"}
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-500 text-center py-1">No live event</p>
          )}

          <div className="flex items-center gap-2">
            <Link
              href="/setup"
              onClick={() => setMobileOpen(false)}
              className="flex flex-1 items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-white bg-nhra-card border border-nhra-border hover:border-nhra-accent/40 transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Change Event
            </Link>
            <span className="shrink-0 rounded-md border border-nhra-border px-1.5 py-1 font-mono text-[0.65rem] text-gray-500" title="App version">
              v{APP_VERSION}
            </span>
          </div>
        </div>
      </nav>

      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
    </>
  );
}
