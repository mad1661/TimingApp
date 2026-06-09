"use client";

import { useState, useEffect } from "react";
import { useLiveData } from "@/components/LiveDataProvider";

interface RawRun {
  ts: string;
  seq: number | null;
  cat: string;
  round: string;
  name: string;
}

interface EventOption {
  event_code: string;
  event_name: string;
  season: string;
  event_type: string;
  start_date: string;
}

export default function DebugPage() {
  const live = useLiveData();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [runs, setRuns] = useState<RawRun[]>([]);
  const [info, setInfo] = useState<{ eventCode: string; season: string; totalInCache: number; withTimestamp: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const [purging, setPurging] = useState(false);

  // Load available events
  useEffect(() => {
    fetch("/api/runs?limit=1")
      .then(r => r.json())
      .then(data => {
        const evts = data.filters?.events || [];
        setEvents(evts);
        // Default to current live event
        if (live.config?.eventCode && live.config?.season) {
          const key = `${live.config.eventCode}|${live.config.season}`;
          const match = evts.find((e: EventOption) => `${e.event_code}|${e.season}` === key);
          if (match) setSelectedEvent(key);
        }
      })
      .catch(console.error);
  }, [live.config?.eventCode, live.config?.season]);

  function getSelected(): EventOption | null {
    if (!selectedEvent) return null;
    const [ec, s] = selectedEvent.split("|");
    return events.find(e => e.event_code === ec && e.season === s) || null;
  }

  async function scrapeAndShow() {
    const ev = getSelected();
    if (!ev || !live.config) { setMessage("Select an event and have credentials configured"); return; }
    setLoading(true);
    setMessage("Scraping fresh data from NHRA...");
    try {
      const fetchRes = await fetch("/api/fetch-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: live.config.username,
          password: live.config.password,
          season: ev.season,
          eventType: ev.event_type,
          eventCode: ev.event_code,
          startDate: ev.start_date,
          eventName: ev.event_name,
        }),
      });
      const fetchData = await fetchRes.json();
      if (fetchData.error) { setMessage(`Scrape error: ${fetchData.error}`); setLoading(false); return; }
      setMessage(`Scraped ${fetchData.totalParsed} runs, ${fetchData.inserted} new. Loading...`);

      const debugRes = await fetch(`/api/stats?type=debug-timestamps&event_code=${encodeURIComponent(ev.event_code)}&season=${encodeURIComponent(ev.season)}`);
      const debugData = await debugRes.json();
      setInfo({ eventCode: debugData.eventCode, season: debugData.season, totalInCache: debugData.totalInCache, withTimestamp: debugData.withTimestamp });
      setRuns(debugData.runs || []);
      setMessage(`Scraped ${fetchData.totalParsed} runs, ${fetchData.inserted} new. Showing ${debugData.runs?.length || 0} of ${debugData.withTimestamp}.`);
    } catch (err) {
      setMessage(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  async function showCached() {
    const ev = getSelected();
    if (!ev) { setMessage("Select an event"); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/stats?type=debug-timestamps&event_code=${encodeURIComponent(ev.event_code)}&season=${encodeURIComponent(ev.season)}`);
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

  async function purgeAndRescrape() {
    const ev = getSelected();
    if (!ev || !live.config) return;
    if (!confirm(`This will DELETE all stored data for "${ev.event_name}" and re-scrape from NHRA. Continue?`)) return;
    setPurging(true);
    setMessage("Purging old data...");
    try {
      const fetchRes = await fetch("/api/fetch-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: live.config.username,
          password: live.config.password,
          season: ev.season,
          eventType: ev.event_type,
          eventCode: ev.event_code,
          startDate: ev.start_date,
          eventName: ev.event_name,
          dataSource: "scraper",
          purge: true,
        }),
      });
      const fetchData = await fetchRes.json();
      if (fetchData.error) { setMessage(`Error: ${fetchData.error}`); setPurging(false); return; }
      setMessage(`Purged & re-scraped: ${fetchData.totalParsed} runs, ${fetchData.inserted} inserted. Loading...`);

      const debugRes = await fetch(`/api/stats?type=debug-timestamps&event_code=${encodeURIComponent(ev.event_code)}&season=${encodeURIComponent(ev.season)}`);
      const debugData = await debugRes.json();
      setInfo({ eventCode: debugData.eventCode, season: debugData.season, totalInCache: debugData.totalInCache, withTimestamp: debugData.withTimestamp });
      setRuns(debugData.runs || []);
      setMessage(`Purged & re-scraped: ${fetchData.totalParsed} runs. All data is fresh with scrape sequences.`);
    } catch (err) {
      setMessage(`Error: ${err}`);
    } finally {
      setPurging(false);
    }
  }

  function copyData() {
    const header = "#\tSeq\tTimestamp\tCategory\tRound\tName";
    const rows = runs.map((r, i) => `${i + 1}\t${r.seq ?? ""}\t${r.ts}\t${r.cat}\t${r.round}\t${r.name}`);
    navigator.clipboard.writeText(`${header}\n${rows.join("\n")}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Debug: Raw Timestamps</h1>
        <p className="text-gray-400">Scrape and inspect raw data with timestamps and sequence numbers</p>
      </div>

      <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">Event</label>
          <select
            value={selectedEvent}
            onChange={(e) => { setSelectedEvent(e.target.value); setRuns([]); setInfo(null); setMessage(""); }}
            className="w-full px-4 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent"
          >
            <option value="">Select Event</option>
            {events.map((e) => (
              <option key={`${e.event_code}|${e.season}`} value={`${e.event_code}|${e.season}`}>
                {e.event_name} ({e.season})
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3 flex-wrap">
          <button
            onClick={scrapeAndShow}
            disabled={loading || !selectedEvent || !live.config}
            className="px-5 py-2.5 bg-nhra-red hover:bg-nhra-red/80 text-white font-bold rounded-lg text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
            Scrape Fresh & Show
          </button>
          <button
            onClick={purgeAndRescrape}
            disabled={loading || purging || !selectedEvent || !live.config}
            className="px-5 py-2.5 bg-red-700 hover:bg-red-600 text-white font-bold rounded-lg text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {purging ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
            Purge & Re-scrape
          </button>
          <button
            onClick={showCached}
            disabled={loading || !selectedEvent}
            className="px-5 py-2.5 bg-nhra-darker border border-nhra-border text-gray-300 hover:text-white rounded-lg text-sm disabled:opacity-50"
          >
            Show Cached
          </button>
          {runs.length > 0 && (
            <button
              onClick={copyData}
              className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              {copied ? "Copied!" : "Copy All Data"}
            </button>
          )}
        </div>

        {message && <p className="mt-3 text-sm text-yellow-400">{message}</p>}
        {info && (
          <div className="mt-3 text-xs text-gray-500 flex gap-4">
            <span>Event: {info.eventCode}</span>
            <span>Season: {info.season}</span>
            <span>Cache: {info.totalInCache} runs</span>
            <span>With timestamp: {info.withTimestamp}</span>
          </div>
        )}
      </div>

      {runs.length > 0 && (
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
