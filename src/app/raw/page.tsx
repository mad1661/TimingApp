"use client";

import { useEffect, useState } from "react";
import { useLiveData } from "@/components/LiveDataProvider";

type RawResult = {
  apiCount?: number;
  mappedCount?: number;
  storedCount?: number;
  apiRaw?: unknown;
  mapped?: unknown;
  stored?: unknown;
};

type Mode = "latest" | "category" | "full";
type HmsEvent = Record<string, unknown>;

const EVENT_TYPES = ["N", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "T"];

function pick(ev: HmsEvent, ...keys: string[]): string {
  for (const k of keys) {
    const v = ev[k];
    if (v != null && v !== "") return String(v);
  }
  return "";
}

export default function RawDataPage() {
  const live = useLiveData();

  // Event selection — defaults to the live event, but editable so you can
  // inspect any event (including one that isn't the saved live config).
  const [eventType, setEventType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [season, setSeason] = useState("");
  const [eventCode, setEventCode] = useState("");
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    if (!filled && live.config) {
      setEventType(live.config.eventType || "");
      setStartDate(live.config.startDate || "");
      setSeason(live.config.season || "");
      setEventCode(live.config.eventCode || "");
      setFilled(true);
    }
  }, [live.config, filled]);

  function useLiveEvent() {
    if (!live.config) return;
    setEventType(live.config.eventType || "");
    setStartDate(live.config.startDate || "");
    setSeason(live.config.season || "");
    setEventCode(live.config.eventCode || "");
  }

  const [mode, setMode] = useState<Mode>("latest");
  const [category, setCategory] = useState("");
  const [count, setCount] = useState(50);

  const [result, setResult] = useState<RawResult | null>(null);
  const [active, setActive] = useState<HmsEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return null;
      }
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function fetchRaw() {
    if (!eventType || !startDate) {
      setError("Enter an Event Type and Start Date (YYYYMMDD).");
      return;
    }
    setResult(null);
    const json = await call({ eventType, startDate, season, eventCode, mode, category, count });
    if (json) setResult(json as RawResult);
  }

  async function loadActive() {
    setActive(null);
    const json = await call({ mode: "active" });
    if (json && Array.isArray(json.active)) setActive(json.active as HmsEvent[]);
  }

  function pickEvent(ev: HmsEvent) {
    const et = pick(ev, "EventType", "eventType", "Type");
    const sd = pick(ev, "StartDate", "startDate", "Date");
    const code = pick(ev, "Code", "EventCode", "eventCode", "code");
    if (et) setEventType(et);
    if (sd) setStartDate(sd);
    if (code) setEventCode(code);
    setActive(null);
  }

  const inputCls =
    "block mt-1 px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm";

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Raw Data</h1>
      <p className="text-gray-400 text-sm mb-6">
        Inspect the raw NHRA API response, the RunRows it maps to, and the stored runs for any event — for
        troubleshooting. The API call runs server-side on the deployed app.
      </p>

      {/* Event selection */}
      <div className="mb-4 p-4 bg-nhra-card border border-nhra-border rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Event</h2>
          <div className="flex gap-2">
            <button
              onClick={useLiveEvent}
              disabled={!live.config}
              className="text-xs px-2 py-1 rounded bg-nhra-darker border border-nhra-border text-gray-300 hover:text-white disabled:opacity-40"
            >
              Use live event
            </button>
            <button
              onClick={loadActive}
              disabled={loading}
              className="text-xs px-2 py-1 rounded bg-nhra-darker border border-nhra-border text-gray-300 hover:text-white disabled:opacity-40"
            >
              Load active events
            </button>
          </div>
        </div>

        {active && (
          <div className="mb-3 border border-nhra-border rounded divide-y divide-nhra-border">
            {active.length === 0 && <p className="text-xs text-gray-500 px-3 py-2">No active events.</p>}
            {active.map((ev, i) => (
              <button
                key={i}
                onClick={() => pickEvent(ev)}
                className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-nhra-darker"
              >
                <span className="text-white font-medium">{pick(ev, "Name", "name") || "(event)"}</span>
                {"  "}
                <span className="text-gray-500">
                  {pick(ev, "EventType", "eventType")} · {pick(ev, "StartDate", "startDate")} ·{" "}
                  {pick(ev, "Code", "EventCode") || "—"} · running={pick(ev, "IsRunning", "isRunning") || "?"} ·{" "}
                  {pick(ev, "Category", "category") || "—"}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-400">
            Event Type
            <select value={eventType} onChange={(e) => setEventType(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-400">
            Start Date (YYYYMMDD)
            <input value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="20260529" className={`${inputCls} w-32`} />
          </label>
          <label className="text-xs text-gray-400">
            Season
            <input value={season} onChange={(e) => setSeason(e.target.value)} placeholder="2026" className={`${inputCls} w-24`} />
          </label>
          <label className="text-xs text-gray-400">
            Event Code (for stored)
            <input value={eventCode} onChange={(e) => setEventCode(e.target.value)} placeholder="EPP" className={`${inputCls} w-28`} />
          </label>
        </div>
      </div>

      {/* What to fetch */}
      <div className="flex flex-wrap items-end gap-3 mb-6 p-4 bg-nhra-card border border-nhra-border rounded-lg">
        <label className="text-xs text-gray-400">
          Source
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={inputCls}>
            <option value="latest">Latest N runs</option>
            <option value="category">Category</option>
            <option value="full">Full event</option>
          </select>
        </label>
        {mode === "latest" && (
          <label className="text-xs text-gray-400">
            Count
            <input type="number" value={count} onChange={(e) => setCount(Number(e.target.value))} className={`${inputCls} w-24`} />
          </label>
        )}
        {mode === "category" && (
          <label className="text-xs text-gray-400">
            Category (e.g. PRO STOCK)
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="PRO STOCK" className={`${inputCls} w-56`} />
          </label>
        )}
        <button
          onClick={fetchRaw}
          disabled={loading}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-nhra-red hover:bg-nhra-red/80 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Fetching…" : "Fetch raw data"}
        </button>
      </div>

      {error && <p className="text-red-400 text-sm mb-4 break-words">{error}</p>}

      {result && (
        <div className="space-y-4">
          <Section title={`Raw API response — ${result.apiCount ?? 0} pairings`} data={result.apiRaw} />
          <Section title={`Mapped RunRows — ${result.mappedCount ?? 0}`} data={result.mapped} />
          <Section title={`Stored runs — ${result.storedCount ?? 0}`} data={result.stored} />
        </div>
      )}
    </div>
  );
}

function Section({ title, data }: { title: string; data: unknown }) {
  const [open, setOpen] = useState(false);
  const json = JSON.stringify(data, null, 2);
  return (
    <div className="bg-nhra-card border border-nhra-border rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard?.writeText(json);
            }}
            className="text-xs px-2 py-1 rounded bg-nhra-darker border border-nhra-border text-gray-300 hover:text-white"
          >
            Copy JSON
          </button>
          <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
        </div>
      </div>
      {open && (
        <pre className="px-4 py-3 text-xs text-gray-300 overflow-auto max-h-[60vh] border-t border-nhra-border whitespace-pre">
          {json}
        </pre>
      )}
    </div>
  );
}
