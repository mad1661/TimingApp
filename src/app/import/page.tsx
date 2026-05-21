"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useLiveData } from "@/components/LiveDataProvider";
import { EVENT_TYPES, SEASONS } from "@/lib/nhra-setup";

interface FetchLogEntry {
  id: string;
  event_code: string;
  season: string;
  event_type: string;
  fetched_at: string;
  run_count: number;
}

export default function ImportPage() {
  const live = useLiveData();

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvEventCode, setCsvEventCode] = useState("");
  const [csvEventName, setCsvEventName] = useState("");
  const [csvEventType, setCsvEventType] = useState("N");
  const [csvSeason, setCsvSeason] = useState("2026");
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvResult, setCsvResult] = useState<{ success: boolean; message: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fetchLog, setFetchLog] = useState<FetchLogEntry[]>([]);

  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((data) => setFetchLog(data.fetchLog || []))
      .catch(() => {});
  }, []);

  async function handleCsvUpload() {
    if (!csvFile) return;
    setCsvLoading(true);
    setCsvResult(null);

    try {
      const formData = new FormData();
      formData.append("file", csvFile);
      formData.append("event_code", csvEventCode || "IMPORT");
      formData.append("event_name", csvEventName || csvFile.name);
      formData.append("event_type", csvEventType);
      formData.append("season", csvSeason);

      const res = await fetch("/api/import-csv", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        setCsvResult({ success: true, message: `Imported ${data.totalParsed} runs, ${data.inserted} new` });
        setCsvFile(null);
        fetch("/api/events").then((r) => r.json()).then((d) => setFetchLog(d.fetchLog || []));
      } else {
        setCsvResult({ success: false, message: data.error || "Failed" });
      }
    } catch {
      setCsvResult({ success: false, message: "Network error" });
    } finally {
      setCsvLoading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".csv") || file.type === "text/csv")) {
      setCsvFile(file);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Import Data</h1>
        <p className="text-gray-400">Upload CSV files or set up a live feed from NHRA</p>
      </div>

      {/* Live Feed Status */}
      {live.isActive ? (
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
              <div>
                <p className="text-green-400 font-semibold">Live feed active</p>
                <p className="text-xs text-gray-400">
                  {live.config?.eventName || live.config?.eventCode} &middot; checking every {live.config?.intervalSeconds}s
                  {live.totalNewRuns > 0 && <span className="text-green-400 ml-1">({live.totalNewRuns} new runs this session)</span>}
                </p>
              </div>
            </div>
            <Link href="/setup" className="px-4 py-2 bg-nhra-card border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white transition-colors">
              Configure
            </Link>
          </div>
        </div>
      ) : (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium">Auto-fetch from NHRA</p>
              <p className="text-xs text-gray-500">Set up continuous live data import from getresults.nhradata.com</p>
            </div>
            <Link href="/setup" className="px-5 py-2.5 bg-nhra-red text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors">
              Set Up Live Feed
            </Link>
          </div>
        </div>
      )}

      {/* CSV Import */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">CSV Import</h2>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${dragActive ? "border-nhra-accent bg-nhra-accent/5" : "border-nhra-border hover:border-gray-500"}`}
        >
          <svg className="w-12 h-12 text-gray-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          {csvFile ? (
            <p className="text-white font-medium">{csvFile.name} <span className="text-gray-400">({(csvFile.size / 1024).toFixed(1)} KB)</span></p>
          ) : (
            <>
              <p className="text-gray-300 font-medium mb-1">Drop a CSV file here or click to browse</p>
              <p className="text-gray-500 text-sm">Supports NHRA timing data CSV format</p>
            </>
          )}
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => { if (e.target.files?.[0]) setCsvFile(e.target.files[0]); }} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Event Code</label>
            <input type="text" value={csvEventCode} onChange={(e) => setCsvEventCode(e.target.value)} placeholder="Optional" className="w-full px-4 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Event Name</label>
            <input type="text" value={csvEventName} onChange={(e) => setCsvEventName(e.target.value)} placeholder="Optional" className="w-full px-4 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Event Type</label>
            <select value={csvEventType} onChange={(e) => setCsvEventType(e.target.value)} className="w-full px-4 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent">
              {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Season</label>
            <select value={csvSeason} onChange={(e) => setCsvSeason(e.target.value)} className="w-full px-4 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent">
              {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <button
          onClick={handleCsvUpload}
          disabled={csvLoading || !csvFile}
          className="mt-6 px-6 py-3 bg-nhra-red text-white rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {csvLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {csvLoading ? "Importing..." : "Import CSV"}
        </button>

        {csvResult && (
          <div className={`mt-4 p-4 rounded-lg text-sm ${csvResult.success ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
            {csvResult.message}
          </div>
        )}
      </div>

      {/* Import History */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
        <div className="p-5 border-b border-nhra-border">
          <h2 className="text-lg font-semibold text-white">Import History</h2>
        </div>
        {fetchLog.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No imports yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                  <th className="text-left p-3 pl-5">Date</th>
                  <th className="text-left p-3">Event</th>
                  <th className="text-left p-3">Type</th>
                  <th className="text-left p-3">Season</th>
                  <th className="text-right p-3 pr-5">Runs</th>
                </tr>
              </thead>
              <tbody>
                {fetchLog.map((entry) => (
                  <tr key={entry.id} className="border-b border-nhra-border/50">
                    <td className="p-3 pl-5 text-gray-300">{entry.fetched_at ? new Date(entry.fetched_at).toLocaleString() : "-"}</td>
                    <td className="p-3 text-white">{entry.event_code}</td>
                    <td className="p-3 text-gray-300">{entry.event_type}</td>
                    <td className="p-3 text-gray-300">{entry.season}</td>
                    <td className="p-3 text-right pr-5 text-white font-mono">{entry.run_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
