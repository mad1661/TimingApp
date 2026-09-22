"use client";

import { useEffect, useRef, useState } from "react";
import { strToU8, zipSync } from "fflate";
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

interface ExportFile {
  filename: string;
  category: string;
  classCode: string;
  rounds: string[];
  pairs: number;
  runs: number;
  enriched: number;
  content: string;
}

interface ExportResult {
  files: ExportFile[];
  warnings: string[];
}

interface AccuSession {
  classCode: string;
  className: string;
  raceDate: string | null;
  qualifiers: number;
  qualSessions: number;
  elimRounds: string[];
  drivers: number;
  treeBase: number;
  warnings: string[];
}

interface AccuTextFile {
  filename: string;
  category: string;
  content?: string;
  rounds?: string[];
  pairs?: number;
  runs?: number;
  enriched?: number;
}

interface AccuResult {
  sessions: AccuSession[];
  edat: (AccuTextFile & { content: string })[];
  qdat: (AccuTextFile & { content: string })[];
  finalsPdfBase64: string | null;
  qualifyingPdfBase64: string | null;
  coverage: { category: string; enriched: number; runs: number }[];
  warnings: string[];
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// EData is a DOS-era format — encode downloads as latin1 bytes, like the
// import path reads them.
function edataBytes(content: string): Uint8Array {
  return strToU8(content, true);
}

function downloadBytes(filename: string, bytes: Uint8Array, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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

  const [tcUploading, setTcUploading] = useState(false);
  const [tcResult, setTcResult] = useState<{ files: number; total: number; saved: number } | null>(
    null,
  );
  const [tcError, setTcError] = useState("");
  const tcFileRef = useRef<HTMLInputElement>(null);

  const [exportLoading, setExportLoading] = useState(false);
  const [exportFiles, setExportFiles] = useState<ExportFile[] | null>(null);
  const [exportWarnings, setExportWarnings] = useState<string[]>([]);
  const [exportError, setExportError] = useState("");
  const [selectedClasses, setSelectedClasses] = useState<Set<string>>(new Set());
  // Guards against a slow response for a previously typed event landing after
  // a newer one.
  const exportFetchSeq = useRef(0);

  const [accuUploading, setAccuUploading] = useState(false);
  const [accuResult, setAccuResult] = useState<AccuResult | null>(null);
  const [accuError, setAccuError] = useState("");
  const [accuNote, setAccuNote] = useState("");
  const [accuProgress, setAccuProgress] = useState<{ stage: string; pct: number | null } | null>(
    null,
  );
  const [accuDragOver, setAccuDragOver] = useState(false);
  const accuFileRef = useRef<HTMLInputElement>(null);

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

  async function handleTechCardUpload(files: File[]) {
    const valid = files.filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (valid.length === 0) {
      setTcError("Tech cards are the Compulink .xlsx / .csv exports.");
      return;
    }
    setTcUploading(true);
    setTcError("");
    setTcResult(null);
    try {
      let total = 0;
      let saved = 0;
      for (const f of valid) {
        const form = new FormData();
        form.append("file", f);
        // Tag with the loaded event so the cards scope to it; untagged cards
        // still enrich everything.
        if (live.config?.eventName) form.append("event_name", live.config.eventName);
        const res = await fetch("/api/tech-cards", { method: "POST", body: form });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ? `${f.name}: ${body.error}` : `${f.name}: upload failed`);
        total += body.total || 0;
        saved += body.saved || 0;
      }
      setTcResult({ files: valid.length, total, saved });
      // Rebuild the class list so names and tech-card coverage pick up the
      // fresh cards immediately.
      if (eventCode.trim() && season.trim()) loadExportClasses(eventCode.trim(), season.trim());
    } catch (err) {
      setTcError(err instanceof Error ? err.message : "Tech card upload failed");
    } finally {
      setTcUploading(false);
      if (tcFileRef.current) tcFileRef.current.value = "";
    }
  }

  async function loadExportClasses(ec: string, s: string) {
    const seq = ++exportFetchSeq.current;
    setExportLoading(true);
    setExportError("");
    try {
      const res = await fetch(
        `/api/edata-export?event_code=${encodeURIComponent(ec)}&season=${encodeURIComponent(s)}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (seq !== exportFetchSeq.current) return;
      if (!res.ok) throw new Error(body.error || "Export failed");
      const result = body as ExportResult;
      setExportFiles(result.files);
      setExportWarnings(result.warnings);
      // Everything starts checked — the common case is "give me the event".
      setSelectedClasses(new Set(result.files.map((f) => f.filename)));
    } catch (err) {
      if (seq !== exportFetchSeq.current) return;
      setExportFiles(null);
      setExportWarnings([]);
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      if (seq === exportFetchSeq.current) setExportLoading(false);
    }
  }

  // The class checklist loads itself whenever the event/season fields settle,
  // so downloading is: tick the classes, hit Download EDAT.
  useEffect(() => {
    const ec = eventCode.trim();
    const s = season.trim();
    setExportFiles(null);
    setExportWarnings([]);
    setExportError("");
    setSelectedClasses(new Set());
    if (!ec || !s) {
      exportFetchSeq.current++; // cancel anything in flight
      return;
    }
    const t = setTimeout(() => loadExportClasses(ec, s), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventCode, season]);

  function toggleClass(filename: string) {
    setSelectedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }

  // fetch() can't report upload progress, so the AccuTime post goes through
  // XHR: a determinate percentage while the files go up, then the caller flips
  // to an indeterminate "building" stage while the server parses and renders.
  function postAccuForm(
    form: FormData,
    onUploadPct: (pct: number | null) => void,
  ): Promise<{ ok: boolean; body: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/accutime-export");
      xhr.upload.onprogress = (e) =>
        onUploadPct(e.lengthComputable && e.total > 0 ? e.loaded / e.total : null);
      xhr.onload = () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          // non-JSON error body — the generic message below covers it
        }
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, body });
      };
      xhr.onerror = () => reject(new Error("Upload failed — network error"));
      xhr.send(form);
    });
  }

  async function handleAccuUpload(files: File[]) {
    // .acc is AccuTime's password-locked archive — it can't be opened here, so
    // it's dropped from the upload with a note rather than failing everything.
    const accFiles = files.filter((f) => /\.acc$/i.test(f.name));
    const valid = files.filter((f) => /\.(dat|qly|ini|dbf|zip)$/i.test(f.name));
    setAccuNote(
      accFiles.length > 0
        ? `${accFiles.map((f) => f.name).join(", ")} skipped — AccuTime .acc archives are password-locked. Use the loose .qly / .dat / Class.ini / Drivers.dbf files from the same folder instead.`
        : "",
    );
    if (valid.length === 0) {
      setAccuError(
        accFiles.length > 0
          ? ""
          : "Upload the AccuTime session files: .dat / .qly / Class.ini / Drivers.dbf (or a zip of them).",
      );
      if (accuFileRef.current) accuFileRef.current.value = "";
      return;
    }
    setAccuUploading(true);
    setAccuError("");
    setAccuResult(null);
    setAccuProgress({ stage: "Uploading session files…", pct: 0 });
    try {
      const form = new FormData();
      for (const f of valid) form.append("files", f);
      if (live.config?.eventName) form.append("event_name", live.config.eventName);
      if (eventCode.trim()) form.append("event_code", eventCode.trim());
      if (season.trim()) form.append("season", season.trim());
      const { ok, body } = await postAccuForm(form, (pct) => {
        if (pct !== null && pct < 1) {
          setAccuProgress({ stage: "Uploading session files…", pct });
        } else {
          // Bytes are up — everything left is server work with no size to count.
          setAccuProgress({ stage: "Reading session · building QDAT / EDAT / PDFs…", pct: null });
        }
      });
      if (!ok) throw new Error((body.error as string) || "AccuTime export failed");
      setAccuResult(body as unknown as AccuResult);
    } catch (err) {
      setAccuError(err instanceof Error ? err.message : "AccuTime export failed");
    } finally {
      setAccuUploading(false);
      setAccuProgress(null);
      if (accuFileRef.current) accuFileRef.current.value = "";
    }
  }

  function accuAllEntries(): Record<string, Uint8Array> {
    const entries: Record<string, Uint8Array> = {};
    if (!accuResult) return entries;
    for (const f of accuResult.edat) entries[f.filename] = edataBytes(f.content);
    for (const f of accuResult.qdat) entries[f.filename] = edataBytes(f.content);
    if (accuResult.finalsPdfBase64) entries["FinalRoundResults.pdf"] = base64ToBytes(accuResult.finalsPdfBase64);
    if (accuResult.qualifyingPdfBase64) entries["Qualifying.pdf"] = base64ToBytes(accuResult.qualifyingPdfBase64);
    return entries;
  }

  function handleDownloadAccuZip() {
    const entries = accuAllEntries();
    if (Object.keys(entries).length === 0) return;
    downloadBytes("RACEDATA.zip", zipSync(entries), "application/zip");
  }

  function handleDownloadEdata() {
    const picked = (exportFiles || []).filter((f) => selectedClasses.has(f.filename));
    if (picked.length === 0) return;
    if (picked.length === 1) {
      downloadBytes(picked[0].filename, edataBytes(picked[0].content), "text/plain");
      return;
    }
    const entries: Record<string, Uint8Array> = {};
    for (const f of picked) entries[f.filename] = edataBytes(f.content);
    downloadBytes("RACEDATA.zip", zipSync(entries), "application/zip");
  }

  const warnings = (result?.perFile || []).flatMap((f) => f.warnings);

  return (
    <div className="max-w-4xl mx-auto pb-16">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">EData</h1>
        <p className="text-gray-400">
          Load elimination results straight from the timing system&apos;s own CompuLink EData files
          when getresults is down or lagging — or export the app&apos;s elimination rounds as EDAT
          files and a RACEDATA.zip.
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

      {/* ——— Export: the reverse direction — stored elim rounds → EDAT files ——— */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
          <div>
            <h2 className="text-white font-bold text-lg">Export EDAT / RACEDATA</h2>
            <p className="text-xs text-gray-400 mt-1 max-w-xl">
              Import the tech cards, tick the classes you want, then Download EDAT — one
              C#EDAT.TXT for a single class, a RACEDATA.zip when several are picked. The list
              shows every class with elimination rounds on file for the event code and season
              above. Full names, member numbers, city, body and engine merge in from the tech
              cards, matched within each class by car number (or driver name); only rounds
              already on file are written, nothing is invented. Pairs are left lane then right;
              rounds imported from EData (no lanes) are written winner-first, CompuLink&apos;s own
              convention.
            </p>
          </div>
        </div>

        {/* Step 1: tech cards — the entry records that turn a bare timing row
            into full name / city / body / engine. */}
        <div className="mt-4 border border-nhra-border rounded-xl px-4 py-3 bg-nhra-darker/50 flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-[16rem] flex-1">
            <p className="text-sm text-white font-semibold">1 · Import tech cards</p>
            <p className="text-xs text-gray-500 mt-0.5">
              The Compulink tech-card export (.xlsx / .csv) with car number, name, city/state,
              member #, class, body and engine. Without it the files carry only what the timing
              system shows — often just an abbreviated name.
            </p>
            {tcResult && (
              <p className="text-xs text-green-400 mt-1">
                {tcResult.total} card{tcResult.total === 1 ? "" : "s"} imported from{" "}
                {tcResult.files} file{tcResult.files === 1 ? "" : "s"} ({tcResult.saved} new or
                updated).
              </p>
            )}
            {tcError && <p className="text-xs text-red-400 mt-1">{tcError}</p>}
          </div>
          <input
            ref={tcFileRef}
            type="file"
            multiple
            accept=".xlsx,.XLSX,.xls,.XLS,.csv,.CSV"
            className="hidden"
            onChange={(e) => handleTechCardUpload(Array.from(e.target.files || []))}
          />
          <button
            onClick={() => tcFileRef.current?.click()}
            disabled={tcUploading}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-nhra-darker border border-nhra-border text-gray-200 hover:text-white hover:border-gray-500 disabled:opacity-40"
          >
            {tcUploading ? "Importing…" : "Import tech cards"}
          </button>
        </div>

        {exportError && (
          <div className="mt-3 bg-red-500/10 border border-red-500/40 text-red-400 rounded-xl px-4 py-3 text-sm">
            {exportError}
          </div>
        )}

        {exportLoading && (
          <p className="mt-3 text-sm text-gray-500">Loading classes with elimination data…</p>
        )}

        {!exportLoading && exportFiles && exportFiles.length === 0 && (
          <p className="mt-3 text-sm text-gray-500">
            No elimination rounds on file for this event yet.
          </p>
        )}

        {!exportLoading && exportFiles && exportFiles.length > 0 && (
          <div className="mt-4 border border-nhra-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-nhra-darker border-b border-nhra-border flex items-center justify-between gap-4 flex-wrap">
              <p className="text-xs text-gray-400">
                <span className="text-white font-semibold">2 · Pick classes</span> —{" "}
                {selectedClasses.size} of {exportFiles.length} selected ·{" "}
                {exportFiles
                  .filter((f) => selectedClasses.has(f.filename))
                  .reduce((n, f) => n + f.pairs, 0)}{" "}
                pairings
              </p>
              <button
                onClick={() =>
                  setSelectedClasses(
                    selectedClasses.size === exportFiles.length
                      ? new Set()
                      : new Set(exportFiles.map((f) => f.filename)),
                  )
                }
                className="text-xs text-gray-400 hover:text-white font-semibold"
              >
                {selectedClasses.size === exportFiles.length ? "Select none" : "Select all"}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-gray-400 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2 w-8"></th>
                    <th className="text-left px-2 py-2 font-medium">Class</th>
                    <th className="text-left px-3 py-2 font-medium">File</th>
                    <th className="text-left px-3 py-2 font-medium">Rounds</th>
                    <th className="text-right px-3 py-2 font-medium">Pairings</th>
                    <th className="text-right px-4 py-2 font-medium">Tech cards</th>
                  </tr>
                </thead>
                <tbody>
                  {exportFiles.map((f) => {
                    const checked = selectedClasses.has(f.filename);
                    return (
                      <tr
                        key={f.filename}
                        onClick={() => toggleClass(f.filename)}
                        className={`border-t border-nhra-border/60 cursor-pointer ${
                          checked ? "bg-nhra-red/5" : "hover:bg-white/[0.02]"
                        }`}
                      >
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleClass(f.filename)}
                            onClick={(e) => e.stopPropagation()}
                            className="accent-nhra-red cursor-pointer"
                          />
                        </td>
                        <td className={`px-2 py-2 ${checked ? "text-white" : "text-gray-400"}`}>
                          {f.category} <span className="text-gray-500">({f.classCode})</span>
                        </td>
                        <td className="px-3 py-2 text-gray-400 font-mono text-xs">{f.filename}</td>
                        <td className="px-3 py-2 text-gray-400">{f.rounds.join(" · ")}</td>
                        <td className="px-3 py-2 text-right text-gray-300">{f.pairs}</td>
                        <td
                          className={`px-4 py-2 text-right ${
                            f.enriched === 0 ? "text-gray-600" : "text-gray-300"
                          }`}
                          title="Runs whose member / city / body / engine came from a tech card"
                        >
                          {f.enriched}/{f.runs}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!exportLoading && exportFiles && exportFiles.length > 0 && (
          <div className="mt-4 flex items-center justify-between gap-4 flex-wrap">
            {(() => {
              const totalRuns = exportFiles.reduce((n, f) => n + f.runs, 0);
              const missing = totalRuns - exportFiles.reduce((n, f) => n + f.enriched, 0);
              return missing > 0 ? (
                <p className="text-xs text-yellow-500">
                  {missing} of {totalRuns} runs missing tech cards — those rows export with only
                  what the timing system shows. Import tech cards above to fill them.
                </p>
              ) : (
                <p className="text-xs text-green-400">
                  Every run has a tech card — full names and entry details included.
                </p>
              );
            })()}
            <button
              onClick={handleDownloadEdata}
              disabled={selectedClasses.size === 0}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-nhra-red text-white hover:bg-red-600 disabled:opacity-40"
              title={
                selectedClasses.size > 1
                  ? "Downloads the selected classes as RACEDATA.zip"
                  : "Downloads the selected class's EDAT file"
              }
            >
              3 · Download EDAT
              {selectedClasses.size > 0
                ? ` (${selectedClasses.size === 1 ? "1 class" : `${selectedClasses.size} classes → zip`})`
                : ""}
            </button>
          </div>
        )}

        {exportFiles && exportFiles.length > 0 && exportWarnings.length > 0 && (
          <div className="mt-3 px-4 py-3 border border-yellow-500/30 rounded-xl bg-yellow-500/5">
            <p className="text-xs font-semibold text-yellow-500 mb-1">
              {exportWarnings.length} thing{exportWarnings.length === 1 ? "" : "s"} to check
            </p>
            <ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside">
              {exportWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ——— AccuTime export: build the whole Compulink package from the
          timing computer's own session files ——— */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
        <div className="mb-2">
          <h2 className="text-white font-bold text-lg">AccuTime export</h2>
          <p className="text-xs text-gray-400 mt-1 max-w-2xl">
            Drop an AccuTime session and get the full Compulink package: qualifying{" "}
            <span className="font-mono">*QDAT.TXT</span>, eliminations{" "}
            <span className="font-mono">*EDAT.TXT</span>, a StarTrak qualifying PDF and the Final
            Round Results PDF (with each class&apos;s round-by-round elimination page). Upload the{" "}
            <span className="font-mono">.dat</span> / <span className="font-mono">.qly</span> /{" "}
            <span className="font-mono">Class.ini</span> / <span className="font-mono">Drivers.dbf</span>{" "}
            files from the session folder (a zip of them works too). The{" "}
            <span className="font-mono">.acc</span> archive is password-locked and isn&apos;t
            needed — the loose files carry the same data. Member #, city, body and engine merge
            from the session&apos;s own driver database and the shared tech cards.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setAccuDragOver(true);
          }}
          onDragLeave={() => setAccuDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setAccuDragOver(false);
            handleAccuUpload(Array.from(e.dataTransfer.files));
          }}
          onClick={() => accuFileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition-colors ${
            accuDragOver ? "border-nhra-red bg-nhra-red/5" : "border-nhra-border hover:border-gray-600"
          }`}
        >
          <input
            ref={accuFileRef}
            type="file"
            multiple
            accept=".dat,.qly,.ini,.dbf,.zip,.DAT,.QLY,.INI,.DBF,.ZIP"
            className="hidden"
            onChange={(e) => handleAccuUpload(Array.from(e.target.files || []))}
          />
          <p className="text-white font-medium mb-1">
            {accuUploading ? "Working…" : "Drop AccuTime session files here"}
          </p>
          <p className="text-xs text-gray-500">
            race.dat + race.qly + Class.ini + Drivers.dbf — no .acc needed, it&apos;s locked
          </p>
        </div>

        {accuProgress && (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <p className="text-xs text-gray-400">{accuProgress.stage}</p>
              {accuProgress.pct !== null && (
                <p className="text-xs text-gray-500 tabular-nums">
                  {Math.round(accuProgress.pct * 100)}%
                </p>
              )}
            </div>
            <div className="h-2 rounded-full bg-nhra-darker border border-nhra-border overflow-hidden">
              {accuProgress.pct !== null ? (
                <div
                  className="h-full bg-nhra-red rounded-full transition-[width] duration-200"
                  style={{ width: `${Math.max(3, accuProgress.pct * 100)}%` }}
                />
              ) : (
                <div className="h-full w-1/3 bg-nhra-red rounded-full animate-progress-slide" />
              )}
            </div>
          </div>
        )}

        {accuNote && (
          <div className="mt-3 bg-yellow-500/5 border border-yellow-500/30 text-yellow-500 rounded-xl px-4 py-3 text-xs">
            {accuNote}
          </div>
        )}

        {accuError && (
          <div className="mt-3 bg-red-500/10 border border-red-500/40 text-red-400 rounded-xl px-4 py-3 text-sm">
            {accuError}
          </div>
        )}

        {accuResult && accuResult.sessions.length > 0 && (
          <div className="mt-4 border border-nhra-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-nhra-darker border-b border-nhra-border flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-white font-semibold">
                {accuResult.sessions.length} session
                {accuResult.sessions.length === 1 ? "" : "s"} ·{" "}
                {accuResult.edat.length} EDAT · {accuResult.qdat.length} QDAT ·{" "}
                {[accuResult.finalsPdfBase64 && "finals PDF", accuResult.qualifyingPdfBase64 && "qualifying PDF"]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <button
                onClick={handleDownloadAccuZip}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-nhra-red text-white hover:bg-red-600"
              >
                Download RACEDATA.zip
              </button>
            </div>
            <div className="divide-y divide-nhra-border/60">
              {accuResult.sessions.map((s) => {
                const cov = accuResult.coverage.find((c) => c.category === s.className);
                return (
                  <div key={s.className} className="px-4 py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="text-white font-medium">
                        {s.className} <span className="text-gray-500">({s.classCode})</span>
                      </span>
                      <span className="text-xs text-gray-400">
                        {s.qualifiers} qualifiers · {s.qualSessions} sessions ·{" "}
                        {s.elimRounds.length ? s.elimRounds.join(" ") : "no elim rounds"}
                        {cov ? ` · tech cards ${cov.enriched}/${cov.runs}` : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Individual downloads */}
            <div className="px-4 py-3 bg-nhra-darker/40 border-t border-nhra-border flex flex-wrap gap-2">
              {accuResult.edat.map((f) => (
                <button
                  key={f.filename}
                  onClick={() => downloadBytes(f.filename, edataBytes(f.content), "text/plain")}
                  className="text-xs px-2.5 py-1 rounded border border-nhra-border text-gray-300 hover:text-white hover:border-gray-500 font-mono"
                >
                  {f.filename}
                </button>
              ))}
              {accuResult.qdat.map((f) => (
                <button
                  key={f.filename}
                  onClick={() => downloadBytes(f.filename, edataBytes(f.content), "text/plain")}
                  className="text-xs px-2.5 py-1 rounded border border-nhra-border text-gray-300 hover:text-white hover:border-gray-500 font-mono"
                >
                  {f.filename}
                </button>
              ))}
              {accuResult.finalsPdfBase64 && (
                <button
                  onClick={() =>
                    downloadBytes(
                      "FinalRoundResults.pdf",
                      base64ToBytes(accuResult.finalsPdfBase64!),
                      "application/pdf",
                    )
                  }
                  className="text-xs px-2.5 py-1 rounded border border-nhra-border text-gray-300 hover:text-white hover:border-gray-500"
                >
                  Final Round Results PDF
                </button>
              )}
              {accuResult.qualifyingPdfBase64 && (
                <button
                  onClick={() =>
                    downloadBytes(
                      "Qualifying.pdf",
                      base64ToBytes(accuResult.qualifyingPdfBase64!),
                      "application/pdf",
                    )
                  }
                  className="text-xs px-2.5 py-1 rounded border border-nhra-border text-gray-300 hover:text-white hover:border-gray-500"
                >
                  Qualifying PDF
                </button>
              )}
            </div>
          </div>
        )}

        {accuResult && accuResult.warnings.length > 0 && (
          <div className="mt-3 px-4 py-3 border border-yellow-500/30 rounded-xl bg-yellow-500/5">
            <p className="text-xs font-semibold text-yellow-500 mb-1">
              {accuResult.warnings.length} note{accuResult.warnings.length === 1 ? "" : "s"}
            </p>
            <ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside">
              {accuResult.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
