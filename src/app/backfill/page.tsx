"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveData } from "@/components/LiveDataProvider";
import { EVENT_TYPES, SEASONS, type NhraEvent } from "@/lib/nhra-setup";

const DONE_KEY = "backfill_done_keys";
const BATCH_SIZE = 3;

interface LogLine {
  ts: string;
  kind: "info" | "ok" | "warn" | "err";
  text: string;
}

function loadDone(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveDone(done: Set<string>) {
  localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
}

function evKey(e: NhraEvent): string {
  return `${e.season}|${e.eventType}|${e.eventCode}|${e.startDate}`;
}

export default function BackfillPage() {
  const live = useLiveData();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromYear, setFromYear] = useState(SEASONS[SEASONS.length - 1]); // oldest
  const [toYear, setToYear] = useState(SEASONS[0]); // newest
  const [types, setTypes] = useState<Record<string, boolean>>({ N: true, D1: true });

  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  const [doneCount, setDoneCount] = useState(0);
  const [stats, setStats] = useState({ events: 0, runs: 0, failures: 0 });
  const [found, setFound] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [current, setCurrent] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);

  useEffect(() => {
    if (live.config) {
      setUsername(live.config.username);
      setPassword(live.config.password);
    }
    setDoneCount(loadDone().size);
  }, [live.config]);

  function addLog(kind: LogLine["kind"], text: string) {
    setLog((prev) => [{ ts: new Date().toLocaleTimeString(), kind, text }, ...prev].slice(0, 250));
  }

  const selectedTypes = EVENT_TYPES.filter((t) => types[t.value]).map((t) => t.value);
  const seasonsInRange = SEASONS.filter((s) => Number(s) >= Number(fromYear) && Number(s) <= Number(toYear));

  async function callApi(payload: Record<string, unknown>) {
    const res = await fetch("/api/backfill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, ...payload }),
    });
    return res.json();
  }

  async function start() {
    if (!username || !password) {
      addLog("err", "Enter your NHRA username and password first.");
      return;
    }
    if (selectedTypes.length === 0) {
      addLog("err", "Select at least one event type.");
      return;
    }

    stopRef.current = false;
    setRunning(true);
    setStats({ events: 0, runs: 0, failures: 0 });
    setFound(0);
    setProcessed(0);
    const done = loadDone();
    addLog("info", `Starting: ${seasonsInRange.length} season(s) x ${selectedTypes.join(", ")}`);

    try {
      for (const season of seasonsInRange) {
        for (const eventType of selectedTypes) {
          if (stopRef.current) throw new Error("stopped");

          setCurrent(`Listing ${season} ${eventType}...`);
          const listRes = await callApi({ mode: "list", season, eventType });
          if (!listRes.success) {
            addLog("err", `List ${season} ${eventType} failed: ${listRes.error || "unknown"}`);
            continue;
          }
          const events: NhraEvent[] = listRes.events || [];
          const pending = events.filter((e) => !done.has(evKey(e)));
          setFound((f) => f + pending.length);
          addLog("info", `${season} ${eventType}: ${events.length} events (${pending.length} to import)`);

          for (let i = 0; i < pending.length; i += BATCH_SIZE) {
            if (stopRef.current) throw new Error("stopped");
            const batch = pending.slice(i, i + BATCH_SIZE);
            setCurrent(`${season} ${eventType}: ${batch.map((e) => e.eventCode).join(", ")}`);

            const res = await callApi({ mode: "events", events: batch });
            if (!res.success) {
              addLog("err", `Batch failed: ${res.error || "unknown"}`);
              setStats((s) => ({ ...s, failures: s.failures + batch.length }));
              continue;
            }

            for (const r of res.results as { key: string; scraped?: number; inserted?: number; error?: string }[]) {
              const label = r.key.split("|").slice(2).join(" ");
              if (r.error) {
                addLog("err", `FAIL ${label}: ${r.error}`);
                setStats((s) => ({ ...s, failures: s.failures + 1 }));
              } else {
                addLog("ok", `${label} — scraped ${r.scraped}, inserted ${r.inserted}`);
                done.add(r.key);
                setStats((s) => ({ events: s.events + 1, runs: s.runs + (r.inserted || 0), failures: s.failures }));
              }
              setProcessed((p) => p + 1);
            }
            saveDone(done);
            setDoneCount(done.size);
          }
        }
      }
      addLog("ok", "Backfill complete.");
    } catch (err) {
      if (err instanceof Error && err.message === "stopped") addLog("warn", "Stopped.");
      else addLog("err", `Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
      setCurrent("");
    }
  }

  function stop() {
    stopRef.current = true;
  }

  function resetProgress() {
    if (!window.confirm("Clear the saved import progress? Already-imported events will be re-scraped on the next run (data is deduped, so nothing duplicates).")) return;
    localStorage.removeItem(DONE_KEY);
    setDoneCount(0);
    addLog("warn", "Progress reset.");
  }

  const pct = found > 0 ? Math.min(100, Math.round((processed / found) * 100)) : 0;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1 sm:mb-2">Backfill History</h1>
        <p className="text-sm sm:text-base text-gray-400">
          Bulk-import past events from getresults into your database. Runs in your browser in small batches; safe to stop and resume.
        </p>
      </div>

      {/* Credentials */}
      {!live.config && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 sm:p-6 mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">NHRA Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} disabled={running}
              className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">NHRA Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={running}
              className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent" />
          </div>
        </div>
      )}

      {/* Scope */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 sm:p-6 mb-6">
        <h2 className="text-base sm:text-lg font-semibold text-white mb-4">Scope</h2>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-sm text-gray-400 mb-1">From season</label>
            <select value={fromYear} onChange={(e) => setFromYear(e.target.value)} disabled={running} aria-label="From season"
              className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent">
              {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">To season</label>
            <select value={toYear} onChange={(e) => setToYear(e.target.value)} disabled={running} aria-label="To season"
              className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent">
              {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <label className="block text-sm text-gray-400 mb-2">Event types</label>
        <div className="flex flex-wrap gap-2">
          {EVENT_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTypes((prev) => ({ ...prev, [t.value]: !prev[t.value] }))}
              disabled={running}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                types[t.value] ? "bg-nhra-red text-white" : "bg-nhra-darker border border-nhra-border text-gray-400 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-600 mt-3">
          {seasonsInRange.length} season(s) &middot; {selectedTypes.length} type(s) selected
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {!running ? (
          <button onClick={start}
            className="px-6 py-3 bg-nhra-red text-white rounded-lg font-semibold hover:bg-red-700 transition-colors flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Start Backfill
          </button>
        ) : (
          <button onClick={stop}
            className="px-6 py-3 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg font-semibold hover:bg-amber-500/30 transition-colors flex items-center gap-2">
            <span className="w-3 h-3 bg-amber-400 rounded-full animate-pulse" />
            Stop
          </button>
        )}
        <button onClick={resetProgress} disabled={running}
          className="px-4 py-3 bg-nhra-card border border-nhra-border text-gray-400 rounded-lg text-sm hover:text-white transition-colors disabled:opacity-50">
          Reset Progress
        </button>
        <span className="text-xs text-gray-500">{doneCount} events imported so far (saved)</span>
      </div>

      {/* Progress */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 sm:p-6 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <Stat label="To import" value={found} />
          <Stat label="Processed" value={processed} />
          <Stat label="Runs inserted" value={stats.runs} accent="green" />
          <Stat label="Failures" value={stats.failures} accent={stats.failures > 0 ? "red" : undefined} />
        </div>
        <div className="w-full h-2 bg-nhra-darker rounded-full overflow-hidden">
          <div className="h-full bg-nhra-red transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        {current && <p className="text-xs text-gray-400 mt-3 truncate">{running && <span className="inline-block w-3 h-3 border-2 border-nhra-accent border-t-transparent rounded-full animate-spin mr-2 align-middle" />}{current}</p>}
      </div>

      {/* Log */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white mb-3">Activity</h2>
        <div className="h-64 overflow-y-auto font-mono text-xs space-y-1">
          {log.length === 0 ? (
            <p className="text-gray-600">No activity yet.</p>
          ) : (
            log.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-gray-600 shrink-0">{l.ts}</span>
                <span className={
                  l.kind === "ok" ? "text-green-400" :
                  l.kind === "warn" ? "text-amber-400" :
                  l.kind === "err" ? "text-red-400" : "text-gray-300"
                }>{l.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: "green" | "red" }) {
  return (
    <div>
      <p className="text-gray-500 text-xs">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold ${accent === "green" ? "text-green-400" : accent === "red" ? "text-red-400" : "text-white"}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
