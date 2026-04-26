"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLiveData, type LiveConfig } from "@/components/LiveDataProvider";

const EVENT_TYPES = [
  { value: "N", label: "National Events" },
  { value: "D1", label: "Division 1" },
  { value: "D2", label: "Division 2" },
  { value: "D3", label: "Division 3" },
  { value: "D4", label: "Division 4" },
  { value: "D5", label: "Division 5" },
  { value: "D6", label: "Division 6" },
  { value: "D7", label: "Division 7" },
];

const SEASONS = Array.from({ length: 18 }, (_, i) => (2026 - i).toString());

interface NhraEvent {
  eventType: string;
  startDate: string;
  eventCode: string;
  season: string;
  displayName: string;
}

interface EventDate {
  value: string;
  label: string;
}

export default function SetupPage() {
  const live = useLiveData();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [season, setSeason] = useState("2026");
  const [eventType, setEventType] = useState("N");
  const [events, setEvents] = useState<NhraEvent[]>([]);
  const [selectedEventIdx, setSelectedEventIdx] = useState<number>(-1);
  const [eventsLoading, setEventsLoading] = useState(false);

  const [eventDates, setEventDates] = useState<EventDate[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [datesLoading, setDatesLoading] = useState(false);

  const [intervalSeconds, setIntervalSeconds] = useState(60);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const [aliasFrom, setAliasFrom] = useState("");
  const [aliasTo, setAliasTo] = useState("");

  useEffect(() => {
    if (live.config) {
      setUsername(live.config.username);
      setPassword(live.config.password);
      setSeason(live.config.season);
      setEventType(live.config.eventType);
      setIntervalSeconds(live.config.intervalSeconds);
      if (live.config.dateFilter) setSelectedDate(live.config.dateFilter);
      setLoggedIn(true);
    }
  }, [live.config]);

  async function handleLogin() {
    setLoginLoading(true);
    setLoginError("");
    try {
      const res = await fetch("/api/fetch-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, season, eventType }),
      });
      const data = await res.json();
      if (data.success && data.events) {
        setEvents(data.events);
        setLoggedIn(true);
        setSelectedEventIdx(-1);
        setEventDates([]);
        setSelectedDate("");
      } else {
        setLoginError(data.error || "Login failed. Check your credentials.");
      }
    } catch {
      setLoginError("Network error. Could not reach the server.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function loadEvents() {
    setEventsLoading(true);
    try {
      const res = await fetch("/api/fetch-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, season, eventType }),
      });
      const data = await res.json();
      if (data.success && data.events) {
        setEvents(data.events);
      }
    } catch {}
    setEventsLoading(false);
  }

  useEffect(() => {
    if (loggedIn && username && password) loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, eventType, loggedIn]);

  // Auto-select the stored event (and load its dates) once the events list
  // populates. Without this, a user returning with prepopulated config sees
  // "-- Select an event --" and no day filter until they pick a different
  // event and come back. Preserves the pre-populated selectedDate.
  useEffect(() => {
    if (!live.config || events.length === 0 || selectedEventIdx >= 0) return;
    const idx = events.findIndex(
      (ev) => ev.eventCode === live.config!.eventCode && ev.startDate === live.config!.startDate
    );
    if (idx < 0) return;
    setSelectedEventIdx(idx);
    const target = events[idx];
    setDatesLoading(true);
    fetch("/api/fetch-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, action: "dates", event: target }),
    })
      .then((res) => res.json())
      .then((data) => { if (data.success && data.dates) setEventDates(data.dates); })
      .catch(() => {})
      .finally(() => setDatesLoading(false));
  }, [events, live.config, selectedEventIdx, username, password]);

  const selectedEvent = selectedEventIdx >= 0 ? events[selectedEventIdx] : null;

  async function loadEventDates(event: NhraEvent) {
    setDatesLoading(true);
    setSelectedDate("");
    try {
      const res = await fetch("/api/fetch-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, action: "dates", event }),
      });
      const data = await res.json();
      if (data.success && data.dates) {
        setEventDates(data.dates);
      }
    } catch {}
    setDatesLoading(false);
  }

  function handleEventSelect(idx: number) {
    setSelectedEventIdx(idx);
    setEventDates([]);
    setSelectedDate("");
    if (idx >= 0 && events[idx]) {
      loadEventDates(events[idx]);
    }
  }

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
    };
    live.setConfig(config);
    live.start();
    router.push("/");
  }

  function handleLogout() {
    live.clearConfig();
    setLoggedIn(false);
    setEvents([]);
    setEventDates([]);
    setSelectedEventIdx(-1);
    setSelectedDate("");
    setUsername("");
    setPassword("");
    router.push("/");
  }

  async function handlePurgeRefetch() {
    if (!live.config) return;
    const ok = window.confirm("This will delete all stored data for this event and re-fetch fresh from getresults. Continue?");
    if (!ok) return;
    setPurging(true);
    setPurgeResult(null);
    try {
      const res = await fetch("/api/fetch-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: live.config.username,
          password: live.config.password,
          season: live.config.season,
          eventType: live.config.eventType,
          eventCode: live.config.eventCode,
          startDate: live.config.startDate,
          eventName: live.config.eventName,
          dateFilter: live.config.dateFilter,
          purge: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPurgeResult(`Done! Re-fetched ${data.totalParsed} runs from getresults.`);
      } else {
        setPurgeResult(`Error: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      setPurgeResult(`Network error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setPurging(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Event Setup</h1>
        <p className="text-gray-400">Change event, day filter, or polling frequency</p>
      </div>

      {/* Current Event Banner */}
      {live.isActive && live.config && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
              <h2 className="text-lg font-semibold text-green-400">Live Feed Active</h2>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => live.fetchNow()}
                disabled={live.isFetching}
                className="px-4 py-2 bg-nhra-card border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {live.isFetching ? (
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                Fetch Now
              </button>
              <button
                onClick={() => live.stop()}
                className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors"
              >
                Stop
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-gray-500 text-xs">Event</p>
              <p className="text-white font-medium">{live.config.eventName}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Polling</p>
              <p className="text-white font-medium">Every {live.config.intervalSeconds}s</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Last Fetch</p>
              <p className="text-white font-medium">{live.lastFetch ? live.lastFetch.toLocaleTimeString() : "Starting..."}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">New Runs</p>
              <p className="text-green-400 font-bold">{live.totalNewRuns}</p>
            </div>
          </div>
          {live.lastError && <p className="text-xs text-red-400 mt-2">{live.lastError}</p>}

          <div className="mt-4 pt-4 border-t border-green-500/10">
            <div className="flex items-center gap-3">
              <button
                onClick={handlePurgeRefetch}
                disabled={purging}
                className="px-4 py-2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg text-sm font-medium hover:bg-amber-500/30 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {purging ? (
                  <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
                {purging ? "Re-fetching..." : "Clear & Re-fetch All Data"}
              </button>
              <span className="text-xs text-gray-500">Deletes stored data and re-scrapes fresh from getresults</span>
            </div>
            {purgeResult && (
              <p className={`text-xs mt-2 ${purgeResult.startsWith("Done") ? "text-green-400" : "text-red-400"}`}>
                {purgeResult}
              </p>
            )}
          </div>

          {/* Category Name Fixes */}
          <div className="mt-4 pt-4 border-t border-green-500/10">
            <h3 className="text-sm font-semibold text-white mb-3">Category Name Corrections</h3>
            <p className="text-xs text-gray-500 mb-3">Rename categories that come in from getresults with the wrong name. The schedule builder will treat both names as the same class.</p>

            {Object.keys(live.config?.categoryAliases || {}).length > 0 && (
              <div className="space-y-2 mb-3">
                {Object.entries(live.config!.categoryAliases!).map(([from, to]) => (
                  <div key={from} className="flex items-center gap-2 bg-nhra-darker rounded-lg px-3 py-2 border border-nhra-border">
                    <span className="text-gray-400 text-sm flex-1 truncate">{from}</span>
                    <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <span className="text-white text-sm font-medium flex-1 truncate">{to}</span>
                    <button
                      onClick={() => {
                        const updated = { ...live.config!.categoryAliases };
                        delete updated[from];
                        const newConfig = { ...live.config!, categoryAliases: updated };
                        live.setConfig(newConfig);
                      }}
                      className="text-red-400/60 hover:text-red-400 transition-colors ml-1 shrink-0"
                      title="Remove"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={aliasFrom}
                onChange={(e) => setAliasFrom(e.target.value)}
                placeholder="Wrong name (e.g. Stock)"
                className="flex-1 px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
              />
              <input
                type="text"
                value={aliasTo}
                onChange={(e) => setAliasTo(e.target.value)}
                placeholder="Correct name (e.g. Stock Eliminator)"
                className="flex-1 px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
              />
              <button
                onClick={() => {
                  if (!aliasFrom.trim() || !aliasTo.trim() || !live.config) return;
                  const updated = { ...(live.config.categoryAliases || {}), [aliasFrom.trim()]: aliasTo.trim() };
                  const newConfig = { ...live.config, categoryAliases: updated };
                  live.setConfig(newConfig);
                  setAliasFrom("");
                  setAliasTo("");
                }}
                disabled={!aliasFrom.trim() || !aliasTo.trim()}
                className="px-4 py-2 bg-nhra-accent/20 text-nhra-accent border border-nhra-accent/30 rounded-lg text-sm font-medium hover:bg-nhra-accent/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Login / Logged-in state */}
      {!loggedIn ? (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-nhra-red flex items-center justify-center text-white font-bold text-sm">1</div>
            <h2 className="text-lg font-semibold text-white">Log In to NHRA</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Username</label>
              <input
                type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                placeholder="Your NHRA username"
                className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Password</label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Your NHRA password"
                onKeyDown={(e) => { if (e.key === "Enter" && username && password) handleLogin(); }}
                className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
              />
            </div>
          </div>
          <button
            onClick={handleLogin}
            disabled={loginLoading || !username || !password}
            className="w-full px-8 py-3 bg-nhra-red text-white rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loginLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loginLoading ? "Connecting..." : "Log In & Load Events"}
          </button>
          {loginError && (
            <div className="mt-4 p-4 rounded-lg text-sm bg-red-500/10 text-red-400 border border-red-500/20">{loginError}</div>
          )}
        </div>
      ) : (
        <>
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
            <button onClick={handleLogout} className="text-xs text-gray-500 hover:text-red-400 transition-colors">Log out</button>
          </div>

          {/* Select Event */}
          <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">Select Event</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Season</label>
                <select value={season} onChange={(e) => {
                  setSeason(e.target.value);
                  setSelectedEventIdx(-1);
                  setEventDates([]);
                  setSelectedDate("");
                }} aria-label="Season"
                  className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent">
                  {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Event Type</label>
                <select value={eventType} onChange={(e) => {
                  setEventType(e.target.value);
                  setSelectedEventIdx(-1);
                  setEventDates([]);
                  setSelectedDate("");
                }} aria-label="Event Type"
                  className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent">
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
                <select value={selectedEventIdx} onChange={(e) => handleEventSelect(Number(e.target.value))} aria-label="Event"
                  className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent">
                  <option value={-1}>-- Select an event --</option>
                  {events.map((ev, i) => (
                    <option key={`${ev.eventCode}-${ev.startDate}`} value={i}>{ev.displayName}</option>
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

                <div className="mt-4">
                  <label className="block text-sm text-gray-400 mb-2">Day Filter</label>
                  {datesLoading ? (
                    <div className="flex items-center gap-3 px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg">
                      <div className="w-4 h-4 border-2 border-nhra-accent border-t-transparent rounded-full animate-spin" />
                      <span className="text-gray-400 text-sm">Loading event days...</span>
                    </div>
                  ) : eventDates.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setSelectedDate("")}
                        className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${selectedDate === "" ? "bg-nhra-red text-white" : "bg-nhra-darker border border-nhra-border text-gray-400 hover:text-white"}`}>
                        All Days ({eventDates.length})
                      </button>
                      {eventDates.map((d) => (
                        <button key={d.value} onClick={() => setSelectedDate(d.value)}
                          className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${selectedDate === d.value ? "bg-nhra-red text-white" : "bg-nhra-darker border border-nhra-border text-gray-400 hover:text-white"}`}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-gray-500 text-sm">All days will be included</div>
                  )}
                  <p className="text-xs text-gray-600 mt-2">
                    {selectedDate ? "Only data from the selected day will be fetched" : "Data from all days of this event will be fetched"}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Polling & Lock In */}
          <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">Polling Frequency</h2>
            <div className="flex flex-wrap gap-2 mb-6">
              {[
                { value: 0, label: "Manual Only" },
                { value: 15, label: "15 sec" },
                { value: 30, label: "30 sec" },
                { value: 60, label: "1 min" },
                { value: 120, label: "2 min" },
                { value: 300, label: "5 min" },
              ].map((opt) => (
                <button key={opt.value} onClick={() => setIntervalSeconds(opt.value)}
                  className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${intervalSeconds === opt.value ? "bg-nhra-red text-white" : "bg-nhra-darker border border-nhra-border text-gray-400 hover:text-white"}`}>
                  {opt.label}
                </button>
              ))}
            </div>

            <button onClick={handleLockIn} disabled={!selectedEvent}
              className="w-full px-6 py-4 bg-nhra-red text-white rounded-lg font-semibold text-lg hover:bg-red-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {live.isActive ? "Switch Event & Go to Dashboard" : "Lock In Event & Go to Dashboard"}
            </button>
            {!selectedEvent && <p className="text-xs text-gray-500 text-center mt-3">Select an event above to enable</p>}
          </div>
        </>
      )}
    </div>
  );
}
