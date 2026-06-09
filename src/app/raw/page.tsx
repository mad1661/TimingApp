"use client";

import { useState } from "react";
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

export default function RawDataPage() {
  const live = useLiveData();
  const [mode, setMode] = useState<Mode>("latest");
  const [category, setCategory] = useState("");
  const [count, setCount] = useState(50);
  const [result, setResult] = useState<RawResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchRaw() {
    if (!live.config) {
      setError("No live event configured — set one up on the Setup page first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          eventType: live.config.eventType,
          startDate: live.config.startDate,
          season: live.config.season,
          eventCode: live.config.eventCode,
          eventName: live.config.eventName,
          mode,
          category,
          count,
        }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Raw Data</h1>
      <p className="text-gray-400 text-sm mb-6">
        Inspect the raw NHRA API response, the RunRows it maps to, and the runs currently stored — for
        troubleshooting. The API call runs server-side on the deployed app.
      </p>

      {!live.config && (
        <p className="text-yellow-400 text-sm mb-4">
          No live event configured. Set one up on the Setup page first.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 mb-6 p-4 bg-nhra-card border border-nhra-border rounded-lg">
        <label className="text-xs text-gray-400">
          Source
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            className="block mt-1 px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm"
          >
            <option value="latest">Latest N runs</option>
            <option value="category">Category</option>
            <option value="full">Full event</option>
          </select>
        </label>

        {mode === "latest" && (
          <label className="text-xs text-gray-400">
            Count
            <input
              type="number"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="block mt-1 w-24 px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm"
            />
          </label>
        )}

        {mode === "category" && (
          <label className="text-xs text-gray-400">
            Category (e.g. PRO STOCK)
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="PRO STOCK"
              className="block mt-1 w-56 px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm"
            />
          </label>
        )}

        <button
          onClick={fetchRaw}
          disabled={loading || !live.config}
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
