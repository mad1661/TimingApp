"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveData } from "@/components/LiveDataProvider";

interface PerFile {
  name: string;
  category: string;
  rounds: string[];
  parsed: number;
  inserted: number;
  warnings: string[];
  error?: string;
}

interface UploadResult {
  files: number;
  totalParsed: number;
  totalInserted: number;
  perFile: PerFile[];
}

export default function EdataPage() {
  const live = useLiveData();
  const source = live.config?.dataSource ?? "scraper";

  const [eventCode, setEventCode] = useState("");
  const [season, setSeason] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Default to the loaded event so the common case needs no typing.
  useEffect(() => {
    if (live.config?.eventCode) setEventCode((p) => p || live.config!.eventCode);
    if (live.config?.season) setSeason((p) => p || live.config!.season);
    if (live.config?.startDate) setRaceDate((p) => p || live.config!.startDate.slice(0, 10));
  }, [live.config]);

  async function handleUpload(files: File[]) {
    const valid = files.filter((f) => /\.(txt|dat)$/i.test(f.name));
    if (valid.length === 0) {
      setError("EData files are .TXT (C11EDAT.TXT, C12EDAT.TXT, …).");
      return;
    }
    if (!eventCode.trim() || !season.trim()) {
      setError("Set the event code and season before uploading.");
      return;
    }

    setUploading(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      for (const f of valid) form.append("files", f);
      form.append("event_code", eventCode.trim());
      form.append("season", season.trim());
      if (raceDate.trim()) form.append("race_date", raceDate.trim());
      if (live.config?.eventName) form.append("event_name", live.config.eventName);
      if (live.config?.eventType) form.append("event_type", live.config.eventType);

      const res = await fetch("/api/edata", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Upload failed");
      setResult(body as UploadResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const warnings = (result?.perFile || []).flatMap((f) => f.warnings);

  return (
    <div className="max-w-4xl mx-auto pb-16">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">EData Import</h1>
        <p className="text-gray-400">
          Load elimination results straight from the timing system&apos;s own CompuLink EData files,
          for when getresults is down or lagging.
        </p>
      </div>

      {/* Source state — the thing that decides whether getresults is consulted. */}
      <div
        className={`mb-6 rounded-xl px-4 py-4 border ${
          source === "edata"
            ? "bg-green-500/10 border-green-500/40"
            : "bg-yellow-500/10 border-yellow-500/40"
        }`}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className={`font-semibold ${source === "edata" ? "text-green-400" : "text-yellow-500"}`}>
              {source === "edata"
                ? "EData is the active source — getresults polling is off."
                : `Active source is ${source === "api" ? "the NHRA API" : "getresults"}.`}
            </p>
            <p className="text-xs text-gray-400 mt-1 max-w-xl">
              {source === "edata"
                ? "Nothing is fetched from getresults or the API while this is set. The rounds you upload here are the only source, so nothing can overwrite them."
                : "Uploaded EData will be merged in, but polling stays on and a later fetch can overwrite it. Switch to EData to stop that."}
            </p>
          </div>
          <button
            onClick={() => live.setDataSource(source === "edata" ? "scraper" : "edata")}
            disabled={!live.config}
            className={`px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 ${
              source === "edata"
                ? "bg-nhra-darker border border-nhra-border text-gray-300 hover:text-white"
                : "bg-nhra-red text-white hover:bg-red-600"
            }`}
          >
            {source === "edata" ? "Back to getresults" : "Use EData only"}
          </button>
        </div>
        {!live.config && (
          <p className="text-xs text-gray-500 mt-2">Load an event on the Dashboard to switch sources.</p>
        )}
      </div>

      <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          <label className="text-xs text-gray-400">
            Event code
            <input
              value={eventCode}
              onChange={(e) => setEventCode(e.target.value)}
              placeholder="e.g. 1234"
              className="mt-1 w-full px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white placeholder-gray-600"
            />
          </label>
          <label className="text-xs text-gray-400">
            Season
            <input
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder="2026"
              className="mt-1 w-full px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white placeholder-gray-600"
            />
          </label>
          <label className="text-xs text-gray-400">
            Race date
            <input
              type="date"
              value={raceDate}
              onChange={(e) => setRaceDate(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white"
            />
          </label>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleUpload(Array.from(e.dataTransfer.files));
          }}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl px-6 py-10 text-center cursor-pointer transition-colors ${
            dragOver ? "border-nhra-red bg-nhra-red/5" : "border-nhra-border hover:border-gray-600"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".txt,.TXT,.dat,.DAT"
            className="hidden"
            onChange={(e) => handleUpload(Array.from(e.target.files || []))}
          />
          <p className="text-white font-medium mb-1">
            {uploading ? "Importing…" : "Drop EData files here"}
          </p>
          <p className="text-xs text-gray-500">
            C11EDAT.TXT, C12EDAT.TXT, … — one per class, and you can drop them all at once.
            Re-importing the same file updates rather than duplicates.
          </p>
        </div>

        <p className="text-xs text-gray-500 mt-4 leading-relaxed">
          EData records the finish order but no clock times or lanes, so each pass is given a
          synthetic timestamp from its round and position in the file. Runs order and pair up
          correctly everywhere in the app, but the times shown on time-of-day views are sequence
          markers, not when the cars actually ran. Winners come from the file&apos;s own pairing
          order, which is how CompuLink records them.
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/40 text-red-400 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-6">
          <div className="px-6 py-3 bg-nhra-darker border-b border-nhra-border">
            <h2 className="text-white font-bold">
              {result.totalInserted} run{result.totalInserted === 1 ? "" : "s"} imported
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {result.files} file{result.files === 1 ? "" : "s"} · {result.totalParsed} parsed ·{" "}
              {result.totalParsed - result.totalInserted} already on file
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-6 py-2 font-medium">File</th>
                  <th className="text-left px-3 py-2 font-medium">Class</th>
                  <th className="text-left px-3 py-2 font-medium">Rounds</th>
                  <th className="text-right px-3 py-2 font-medium">Parsed</th>
                  <th className="text-right px-6 py-2 font-medium">New</th>
                </tr>
              </thead>
              <tbody>
                {result.perFile.map((f) => (
                  <tr key={f.name} className="border-t border-nhra-border/60">
                    <td className="px-6 py-2 text-white">{f.name}</td>
                    <td className="px-3 py-2 text-gray-300">
                      {f.error ? <span className="text-red-400">{f.error}</span> : f.category || "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{f.rounds.join(" · ") || "—"}</td>
                    <td className="px-3 py-2 text-right text-gray-300">{f.parsed}</td>
                    <td className="px-6 py-2 text-right font-semibold text-white">{f.inserted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {warnings.length > 0 && (
            <div className="px-6 py-3 border-t border-nhra-border bg-yellow-500/5">
              <p className="text-xs font-semibold text-yellow-500 mb-1">
                {warnings.length} thing{warnings.length === 1 ? "" : "s"} to check
              </p>
              <ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
