"use client";

import { useState, useEffect } from "react";
import { useLiveData, type LiveConfig } from "@/components/LiveDataProvider";
import { EVENT_TYPES, SEASONS } from "@/lib/nhra-setup";
import { useNhraSetup } from "@/hooks/useNhraSetup";

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
      dataSource: "api",
    };
    live.setConfig(config);
    live.start();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-3 sm:p-4 bg-nhra-darker">
      <div className="w-full max-w-2xl">
        {/* Header / Logo */}
        <div className="text-center mb-6 sm:mb-10">
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-nhra-red flex items-center justify-center font-bold text-white text-xl sm:text-2xl mx-auto mb-3 sm:mb-4">
            TD
          </div>
          <h1 className="text-2xl sm:text-4xl font-bold text-white tracking-tight">Timing Data</h1>
          <p className="text-sm sm:text-base text-gray-400 mt-1 sm:mt-2">Rice is Great All Year</p>
        </div>

        {/* Step 1: Login */}
        {!loggedIn ? (
          <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 sm:p-8">
            <div className="flex items-center gap-3 mb-5 sm:mb-6">
              <div className="w-8 h-8 rounded-full bg-nhra-red flex items-center justify-center text-white font-bold text-sm">1</div>
              <h2 className="text-base sm:text-lg font-semibold text-white">Log In to NHRA</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5 sm:mb-6">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your NHRA username"
                  className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your NHRA password"
                  onKeyDown={(e) => { if (e.key === "Enter" && username && password) handleLogin(); }}
                  className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
                />
              </div>
            </div>

            <button
              onClick={handleLogin}
              disabled={loginLoading || !username || !password}
              className="w-full px-8 py-3.5 bg-nhra-red text-white rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loginLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {loginLoading ? "Connecting..." : "Log In & Load Events"}
            </button>

            {loginError && (
              <div className="mt-4 p-4 rounded-lg text-sm bg-red-500/10 text-red-400 border border-red-500/20">
                {loginError}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Logged in badge */}
            <div className="bg-nhra-card border border-nhra-border rounded-xl p-4 mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-white font-medium text-sm">Connected to NHRA</p>
                  <p className="text-xs text-gray-500">getresults.nhradata.com</p>
                </div>
              </div>
              <button
                onClick={() => { setLoggedIn(false); setEvents([]); setSelectedEventIdx(-1); setEventDates([]); }}
                className="text-xs text-gray-500 hover:text-red-400 transition-colors"
              >
                Log out
              </button>
            </div>

            {/* Step 2: Select Event */}
            <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 sm:p-8 mb-6">
              <div className="flex items-center gap-3 mb-5 sm:mb-6">
                <div className="w-8 h-8 rounded-full bg-nhra-red flex items-center justify-center text-white font-bold text-sm">2</div>
                <h2 className="text-base sm:text-lg font-semibold text-white">Select Event</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Season</label>
                  <select
                    value={season}
                    onChange={(e) => setSeason(e.target.value)}
                    aria-label="Season"
                    className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent"
                  >
                    {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Event Type</label>
                  <select
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                    aria-label="Event Type"
                    className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent"
                  >
                    {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="mb-2">
                <label className="block text-sm text-gray-400 mb-1">Event</label>
                {eventsLoading ? (
                  <div className="flex items-center gap-3 px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg">
                    <div className="w-4 h-4 border-2 border-nhra-accent border-t-transparent rounded-full animate-spin" />
                    <span className="text-gray-400 text-sm">Loading events from NHRA...</span>
                  </div>
                ) : events.length === 0 ? (
                  <div className="px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-gray-500 text-sm">
                    No events found for {season} &middot; {EVENT_TYPES.find((t) => t.value === eventType)?.label || eventType}. Try a different season or event type above.
                  </div>
                ) : (
                  <select
                    value={selectedEventIdx}
                    onChange={(e) => handleEventSelect(Number(e.target.value))}
                    aria-label="Event"
                    className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent"
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
                  <div className="mt-4 p-4 bg-nhra-darker rounded-lg border border-nhra-border grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500 text-xs">Event Code</p>
                      <p className="text-white font-mono font-medium">{selectedEvent.eventCode}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Start Date</p>
                      <p className="text-white font-mono font-medium">{selectedEvent.startDate}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Season</p>
                      <p className="text-white font-mono font-medium">{selectedEvent.season}</p>
                    </div>
                  </div>

                  {/* Day Selection */}
                  <div className="mt-4">
                    <label className="block text-sm text-gray-400 mb-2">Day Filter</label>
                    {datesLoading ? (
                      <div className="flex items-center gap-3 px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg">
                        <div className="w-4 h-4 border-2 border-nhra-accent border-t-transparent rounded-full animate-spin" />
                        <span className="text-gray-400 text-sm">Loading event days...</span>
                      </div>
                    ) : eventDates.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setSelectedDate("")}
                          className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
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
                            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
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
                      <div className="px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-gray-500 text-sm">
                        All days will be included
                      </div>
                    )}
                    <p className="text-xs text-gray-600 mt-2">
                      {selectedDate
                        ? "Only data from the selected day will be fetched"
                        : "Data from all days of this event will be fetched"}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Step 3: Polling & Lock In */}
            <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 sm:p-8">
              <div className="flex items-center gap-3 mb-5 sm:mb-6">
                <div className="w-8 h-8 rounded-full bg-nhra-red flex items-center justify-center text-white font-bold text-sm">3</div>
                <h2 className="text-base sm:text-lg font-semibold text-white">Lock In &amp; Go</h2>
              </div>

              <p className="text-sm text-gray-400 mb-4">How often should the app check for new data?</p>
              <div className="flex flex-wrap gap-2 mb-6">
                {[
                  { value: 0, label: "Manual Only" },
                  { value: 15, label: "15 sec" },
                  { value: 30, label: "30 sec" },
                  { value: 60, label: "1 min" },
                  { value: 120, label: "2 min" },
                  { value: 300, label: "5 min" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setIntervalSeconds(opt.value)}
                    className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
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
                className="w-full px-6 py-4 bg-nhra-red text-white rounded-lg font-semibold text-lg hover:bg-red-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-3"
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
  );
}
