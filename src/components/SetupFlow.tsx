"use client";

import { useState, useEffect } from "react";
import { useLiveData, type LiveConfig } from "@/components/LiveDataProvider";
import { EVENT_TYPES, SEASONS } from "@/lib/nhra-setup";
import { useNhraSetup } from "@/hooks/useNhraSetup";
import BrandMark from "@/components/BrandMark";

export default function SetupFlow() {
  const live = useLiveData();

  const {
    username, setUsername,
    password, setPassword,
    loggedIn, setLoggedIn,
    loginLoading, loginError,
    season, setSeason,
    eventType, setEventType,
    events, setEvents,
    selectedEventIdx, setSelectedEventIdx,
    eventsLoading,
    eventDates, setEventDates,
    selectedDate, setSelectedDate,
    datesLoading,
    selectedEvent,
    handleLogin, loadEvents, handleEventSelect,
  } = useNhraSetup();

  const [intervalSeconds, setIntervalSeconds] = useState(60);

  useEffect(() => {
    if (loggedIn) {
      setSelectedEventIdx(-1);
      setEventDates([]);
      setSelectedDate("");
      loadEvents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, eventType]);

  function handleLockIn() {
    if (!selectedEvent) return;
    const config: LiveConfig = {
      username,
      password,
      season: selectedEvent.season,
      eventType: selectedEvent.eventType,
      eventCode: selectedEvent.eventCode,
      startDate: selectedEvent.startDate,
      eventName: selectedEvent.displayName,
      intervalSeconds,
      dateFilter: selectedDate || undefined,
      dataSource: "scraper",
    };
    live.setConfig(config);
    live.start();
  }

  const step = !loggedIn ? 1 : selectedEvent ? 3 : 2;

  return (
    <div className="relative min-h-screen overflow-hidden bg-nhra-darker">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 [background:radial-gradient(900px_460px_at_50%_-140px,rgb(200_16_46/0.22),transparent_70%),radial-gradient(760px_480px_at_100%_105%,rgb(0_61_165/0.24),transparent_70%)] light:[background:radial-gradient(900px_460px_at_50%_-140px,rgb(200_16_46/0.09),transparent_70%),radial-gradient(760px_480px_at_100%_105%,rgb(37_99_235/0.09),transparent_70%)]" />
        <div className="absolute inset-0 text-white/[0.045] light:text-slate-900/[0.05] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_65%_60%_at_50%_35%,#000,transparent)]" />
      </div>

      <div className="relative flex min-h-screen items-center justify-center p-3 sm:p-6">
        <div className="w-full max-w-2xl py-6 sm:py-10">
          {/* Header / Logo */}
          <div className="text-center mb-6 sm:mb-8">
            <div className="flex justify-center mb-4 sm:mb-5">
              <BrandMark size="lg" />
            </div>
            <h1 className="font-display text-3xl sm:text-5xl font-bold text-white tracking-tight">Timing Data</h1>
            <p className="text-sm sm:text-base text-gray-400 mt-1.5 sm:mt-2">Rice is Great All Year</p>
          </div>

          <SetupSteps step={step} />

          {/* Step 1: Login */}
          {!loggedIn ? (
            <div className="bg-nhra-card border border-nhra-border rounded-2xl p-5 sm:p-8">
              <StepHeader n={1} title="Log In to NHRA" hint="Your getresults.nhradata.com account" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5 sm:mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Your NHRA username"
                    className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your NHRA password"
                    onKeyDown={(e) => { if (e.key === "Enter" && username && password) handleLogin(); }}
                    className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
                  />
                </div>
              </div>

              <button
                onClick={handleLogin}
                disabled={loginLoading || !username || !password}
                className="w-full px-8 py-3.5 bg-nhra-red text-white rounded-xl font-semibold hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loginLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {loginLoading ? "Connecting..." : "Log In & Load Events"}
              </button>

              {loginError && (
                <div className="mt-4 p-4 rounded-xl text-sm bg-red-500/10 text-red-400 border border-red-500/20">
                  {loginError}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Logged in badge */}
              <div className="bg-nhra-card border border-nhra-border rounded-2xl p-4 mb-5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-green-500/15 ring-1 ring-inset ring-green-500/30 flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">Connected to NHRA</p>
                    <p className="text-xs text-gray-500 font-mono">getresults.nhradata.com</p>
                  </div>
                </div>
                <button
                  onClick={() => { setLoggedIn(false); setEvents([]); setSelectedEventIdx(-1); setEventDates([]); }}
                  className="rounded-lg border border-nhra-border px-3 py-1.5 text-xs font-medium text-gray-400 hover:border-red-500/40 hover:text-red-400 transition-colors"
                >
                  Log out
                </button>
              </div>

              {/* Step 2: Select Event */}
              <div className="bg-nhra-card border border-nhra-border rounded-2xl p-5 sm:p-8 mb-5">
                <StepHeader n={2} title="Select Event" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Season</label>
                    <select
                      value={season}
                      onChange={(e) => setSeason(e.target.value)}
                      aria-label="Season"
                      className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-xl text-white focus:outline-none focus:border-nhra-accent"
                    >
                      {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Event Type</label>
                    <select
                      value={eventType}
                      onChange={(e) => setEventType(e.target.value)}
                      aria-label="Event Type"
                      className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-xl text-white focus:outline-none focus:border-nhra-accent"
                    >
                      {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="mb-2">
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Event</label>
                  {eventsLoading ? (
                    <div className="flex items-center gap-3 px-4 py-3 bg-nhra-darker border border-nhra-border rounded-xl">
                      <div className="w-4 h-4 border-2 border-nhra-accent border-t-transparent rounded-full animate-spin" />
                      <span className="text-gray-400 text-sm">Loading events from NHRA...</span>
                    </div>
                  ) : events.length === 0 ? (
                    <div className="px-4 py-3 bg-nhra-darker border border-dashed border-nhra-border rounded-xl text-gray-500 text-sm">
                      No events found for {season} &middot; {EVENT_TYPES.find((t) => t.value === eventType)?.label || eventType}. Try a different season or event type above.
                    </div>
                  ) : (
                    <select
                      value={selectedEventIdx}
                      onChange={(e) => handleEventSelect(Number(e.target.value))}
                      aria-label="Event"
                      className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-xl text-white focus:outline-none focus:border-nhra-accent"
                    >
                      <option value={-1}>-- Select an event --</option>
                      {events.map((ev, i) => (
                        <option key={`${ev.eventCode}-${ev.startDate}`} value={i}>
                          {ev.displayName}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {selectedEvent && (
                  <>
                    <div className="mt-4 grid grid-cols-3 divide-x divide-nhra-border rounded-xl border border-nhra-border bg-nhra-darker text-sm">
                      <div className="px-4 py-3">
                        <p className="text-gray-500 text-[0.7rem] font-semibold uppercase tracking-wider">Event Code</p>
                        <p className="mt-0.5 text-white font-mono font-medium">{selectedEvent.eventCode}</p>
                      </div>
                      <div className="px-4 py-3">
                        <p className="text-gray-500 text-[0.7rem] font-semibold uppercase tracking-wider">Start Date</p>
                        <p className="mt-0.5 text-white font-mono font-medium">{selectedEvent.startDate}</p>
                      </div>
                      <div className="px-4 py-3">
                        <p className="text-gray-500 text-[0.7rem] font-semibold uppercase tracking-wider">Season</p>
                        <p className="mt-0.5 text-white font-mono font-medium">{selectedEvent.season}</p>
                      </div>
                    </div>

                    {/* Day Selection */}
                    <div className="mt-5">
                      <label className="block text-sm font-medium text-gray-300 mb-2">Day Filter</label>
                      {datesLoading ? (
                        <div className="flex items-center gap-3 px-4 py-3 bg-nhra-darker border border-nhra-border rounded-xl">
                          <div className="w-4 h-4 border-2 border-nhra-accent border-t-transparent rounded-full animate-spin" />
                          <span className="text-gray-400 text-sm">Loading event days...</span>
                        </div>
                      ) : eventDates.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => setSelectedDate("")}
                            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                              selectedDate === ""
                                ? "bg-nhra-red text-white"
                                : "bg-nhra-darker border border-nhra-border text-gray-400 hover:text-white"
                            }`}
                          >
                            All Days ({eventDates.length})
                          </button>
                          {eventDates.map((d) => (
                            <button
                              key={d.value}
                              onClick={() => setSelectedDate(d.value)}
                              className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                                selectedDate === d.value
                                  ? "bg-nhra-red text-white"
                                  : "bg-nhra-darker border border-nhra-border text-gray-400 hover:text-white"
                              }`}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="px-4 py-3 bg-nhra-darker border border-nhra-border rounded-xl text-gray-500 text-sm">
                          All days will be included
                        </div>
                      )}
                      <p className="text-xs text-gray-500 mt-2">
                        {selectedDate
                          ? "Only data from the selected day will be fetched"
                          : "Data from all days of this event will be fetched"}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Step 3: Polling & Lock In */}
              <div className="bg-nhra-card border border-nhra-border rounded-2xl p-5 sm:p-8">
                <StepHeader n={3} title="Lock In & Go" hint="How often should the app check for new data?" />

                <div className="flex flex-wrap gap-2 mb-6">
                  {[
                    { value: 0, label: "Manual Only" },
                    { value: 15, label: "15 sec" },
                    { value: 30, label: "30 sec" },
                    { value: 60, label: "1 min" },
                    { value: 120, label: "2 min" },
                    { value: 300, label: "5 min" },
                    { value: 900, label: "15 min" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setIntervalSeconds(opt.value)}
                      className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                        intervalSeconds === opt.value
                          ? "bg-nhra-red text-white"
                          : "bg-nhra-darker border border-nhra-border text-gray-400 hover:text-white"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleLockIn}
                  disabled={!selectedEvent}
                  className="w-full px-6 py-4 bg-nhra-red text-white rounded-xl font-display font-bold text-xl tracking-wide hover:bg-red-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Lock In Event &amp; Start
                </button>

                {!selectedEvent && (
                  <p className="text-xs text-gray-500 text-center mt-3">Select an event above to enable</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const SETUP_STEPS = ["Log in", "Choose event", "Lock in"];

function SetupSteps({ step }: { step: number }) {
  return (
    <ol className="mb-5 sm:mb-6 flex items-center justify-center gap-2 sm:gap-3">
      {SETUP_STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={label} className="flex items-center gap-2 sm:gap-3">
            {i > 0 && <span className={`h-px w-6 sm:w-10 ${n <= step ? "bg-nhra-red/60" : "bg-nhra-border"}`} />}
            <span
              aria-current={current ? "step" : undefined}
              className={`flex items-center gap-2 text-xs sm:text-sm font-medium ${current ? "text-white" : done ? "text-gray-300" : "text-gray-500"}`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[0.7rem] font-bold ${
                  done
                    ? "bg-green-500/15 text-green-400 ring-1 ring-inset ring-green-500/30"
                    : current
                      ? "bg-nhra-red text-white"
                      : "border border-nhra-border bg-nhra-card text-gray-500"
                }`}
              >
                {done ? (
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  n
                )}
              </span>
              <span className={current ? "" : "hidden sm:inline"}>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepHeader({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3.5 mb-5 sm:mb-6">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-nhra-red/12 font-display text-base font-bold text-nhra-red ring-1 ring-inset ring-nhra-red/25">
        {n}
      </span>
      <div className="min-w-0 pt-0.5">
        <h2 className="text-lg sm:text-xl font-bold text-white leading-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-gray-500">{hint}</p>}
      </div>
    </div>
  );
}
