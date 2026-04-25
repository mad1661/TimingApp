"use client";

import { useState } from "react";
import { useLiveData } from "@/components/LiveDataProvider";

interface RawRun {
  ts: string;
  seq: number | null;
  cat: string;
  round: string;
  name: string;
}

export default function DebugPage() {
  const live = useLiveData();
  const [runs, setRuns] = useState<RawRun[]>([]);
  const [info, setInfo] = useState<{ eventCode: string; season: string; totalInCache: number; withTimestamp: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const ec = live.config?.eventCode || "";
  const season = live.config?.season || "";

  async function scrapeAndShow() {
    if (!live.config) { setMessage("No event configured"); return; }
    setLoading(true);
    setMessage("Scraping fresh data from NHRA...");
    try {
      const fetchRes = await fetch("/api/fetch-data", {
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
          dateFilter: live.config.dateFilter || undefined,
        }),
      });
      const fetchData = await fetchRes.json();
      setMessage(`Scraped ${fetchData.totalParsed} runs, ${fetchData.inserted} new. Loading debug view...`);

      const debugRes = await fetch(`/api/stats?type=debug-timestamps&event_code=${encodeURIComponent(ec)}&season=${encodeURIComponent(season)}`);
      const debugData = await debugRes.json();
      setInfo({ eventCode: debugData.eventCode, season: debugData.season, totalInCache: debugData.totalInCache, withTimestamp: debugData.withTimestamp });
      setRuns(debugData.runs || []);
      setMessage(`Scraped ${fetchData.totalParsed} runs, ${fetchData.inserted} new. Showing ${debugData.runs?.length || 0} of ${debugData.withTimestamp} with timestamps.`);
    } catch (err) {
      setMessage(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  async function showCached() {
    if (!ec || !season) { setMessage("No event configured"); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/stats?type=debug-timestamps&event_code=${encodeURIComponent(ec)}&season=${encodeURIComponent(season)}`);
      const data = await res.json();
      setInfo({ eventCode: data.eventCode, season: data.season, totalInCache: data.totalInCache, withTimestamp: data.withTimestamp });
      setRuns(data.runs || []);
      setMessage(`Showing ${data.runs?.length || 0} of ${data.withTimestamp} cached runs.`);
    } catch (err) {
      setMessage(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Debug: Raw Timestamps</h1>
        <p className="text-gray-400">See the raw scrape data with timestamps and sequence numbers</p>
      </div>

      <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
        <p className="text-sm text-gray-400 mb-3">
          Event: <span className="text-white font-bold">{live.config?.eventName || "None"}</span>
          {ec && <span className="text-gray-500 ml-2">(code={ec}, season={season})</span>}
        </p>
        <div className="flex gap-3">
          <button
            onClick={scrapeAndShow}
            disabled={loading || !live.config}
            className="px-5 py-2.5 bg-nhra-red hover:bg-nhra-red/80 text-white font-bold rounded-lg text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
            Scrape Fresh & Show
          </button>
          <button
            onClick={showCached}
            disabled={loading || !ec}
            className="px-5 py-2.5 bg-nhra-darker border border-nhra-border text-gray-300 hover:text-white rounded-lg text-sm disabled:opacity-50"
          >
            Show Cached Data
          </button>
        </div>
        {message && <p className="mt-3 text-sm text-yellow-400">{message}</p>}
        {info && (
          <div className="mt-3 text-xs text-gray-500 flex gap-4">
            <span>Cache: {info.totalInCache} runs</span>
            <span>With timestamp: {info.withTimestamp}</span>
          </div>
        )}
      </div>

      {runs.length > 0 && (
        <div className="flex justify-end mb-2">
          <button
            onClick={() => {
              const text = runs.map((r, i) => `${i + 1}\t${r.seq ?? ""}\t${r.ts}\t${r.cat}\t${r.round}\t${r.name}`).join("\n");
              navigator.clipboard.writeText(`#\tSeq\tTimestamp\tCategory\tRound\tName\n${text}`);
            }}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            Copy All Data
          </button>
        </div>
      )}
        <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-xs font-mono">
              <thead className="sticky top-0 bg-nhra-darker">
                <tr className="border-b border-nhra-border text-gray-400 uppercase">
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">Seq</th>
                  <th className="p-2 text-left">Timestamp</th>
                  <th className="p-2 text-left">Category</th>
                  <th className="p-2 text-left">Round</th>
                  <th className="p-2 text-left">Name</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => {
                  const h = parseInt(r.ts?.split(" ")[1]?.split(":")[0] || "0", 10);
                  const isPmHour = (h >= 1 && h <= 5) || h === 12;
                  return (
                    <tr key={i} className={`border-b border-nhra-border/20 ${isPmHour ? "bg-blue-500/5" : ""}`}>
                      <td className="p-2 text-gray-600">{i + 1}</td>
                      <td className="p-2 text-gray-400">{r.seq ?? "—"}</td>
                      <td className="p-2 text-white">{r.ts}</td>
                      <td className="p-2 text-gray-300">{r.cat}</td>
                      <td className="p-2 text-gray-300">{r.round}</td>
                      <td className="p-2 text-gray-400">{r.name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
