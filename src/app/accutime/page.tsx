"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { strToU8, unzipSync, zipSync } from "fflate";
import { useLiveData } from "@/components/LiveDataProvider";
import {
  AccutimeRun,
  ClassIniMeta,
  QlyEntry,
  classNameFromCode,
  defaultTreeBase,
  fieldSizeForClassName,
  indexByCarFromQualRuns,
  looksLikeQly,
  parseClassIni,
  parseQly,
  qualifyingFromDatRuns,
  accutimeRunsToRunRows,
} from "@/lib/accutime-parse";
import { buildEdataExport, EdataTechCard } from "@/lib/edata-export";
import { buildQdatFile, padToCompulinkBlock, QdatFile } from "@/lib/qdat-export";

/**
 * AccuTime → Compulink export package. Feed it the timing system's own session
 * files (race.qly / race.dat / Class.ini — one set per class) and it produces:
 *   1. C#QDAT.TXT   — Compulink StarTrak qualifying data
 *   2. C#EDAT.TXT   — Compulink StarTrak elimination results
 *   3. Qualifying Listing PDF (StarTrak sheet, with the field-size bump line)
 *   4. Final Round Results PDF (same output as racedata-zip-to-pdf)
 * Tech cards enrich every output (member numbers, full names, hometowns,
 * bodies, motors) through the same import/store the EDAT export uses.
 */

interface Session {
  id: string;
  className: string;
  classCode: string;
  channel: number;
  fieldSize: string; // keep as text for the input; parsed when used
  sessionLabel: string;
  treeBase: number;
  qly: QlyEntry[] | null;
  datRuns: AccutimeRun[] | null;
  ini: ClassIniMeta | null;
  files: string[];
  warnings: string[];
  selected: boolean;
}

interface HeaderFields {
  track: string;
  city: string;
  division: string;
  eventName: string;
  eventDates: string;
  roundDate: string; // "21/SEP/2026"
}

const HEADER_KEY = "timindata_accutime_header";

function latin1Bytes(content: string): Uint8Array {
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

function fileBytes(content: string): Uint8Array {
  return padToCompulinkBlock(latin1Bytes(content));
}

/** "2026-09-18" → "18/SEP/2026". */
function roundDateFromIso(iso: string): string {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${m[3]}/${months[parseInt(m[2], 10) - 1]}/${m[1]}`;
}

function nowTimeStr(): string {
  const d = new Date();
  let h = d.getHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${ap}`;
}

export default function AccutimePage() {
  const live = useLiveData();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [techCards, setTechCards] = useState<EdataTechCard[]>([]);
  const [techStatus, setTechStatus] = useState("");
  const [techUploading, setTechUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [header, setHeader] = useState<HeaderFields>({
    track: "",
    city: "",
    division: "",
    eventName: "",
    eventDates: "",
    roundDate: "",
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const techFileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // Header fields persist locally — track/city/division rarely change.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HEADER_KEY);
      if (saved) setHeader((h) => ({ ...h, ...JSON.parse(saved) }));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(HEADER_KEY, JSON.stringify(header));
    } catch {}
  }, [header]);

  const loadTechCards = useCallback(async () => {
    try {
      const res = await fetch("/api/tech-cards?all=1", { cache: "no-store" });
      const data = await res.json();
      const cards = (data.results || []) as EdataTechCard[];
      setTechCards(cards);
      setTechStatus(`${cards.length} tech cards on file`);
    } catch {
      setTechStatus("Tech cards unavailable — exports still work, entry fields stay blank.");
    }
  }, []);
  useEffect(() => {
    loadTechCards();
  }, [loadTechCards]);

  async function handleTechUpload(files: File[]) {
    const valid = files.filter((f) => ["xlsx", "xls", "csv"].includes(f.name.split(".").pop()?.toLowerCase() || ""));
    if (valid.length === 0) return;
    setTechUploading(true);
    let saved = 0;
    let failed = 0;
    for (const file of valid) {
      const formData = new FormData();
      formData.append("file", file);
      if (live.config?.eventName) formData.append("event_name", live.config.eventName);
      try {
        const res = await fetch("/api/tech-cards", { method: "POST", body: formData });
        const data = await res.json();
        if (res.ok) saved += data.saved || 0;
        else failed++;
      } catch {
        failed++;
      }
    }
    setTechUploading(false);
    setTechStatus(`${saved} tech cards imported${failed ? `, ${failed} file(s) failed` : ""} — reloading…`);
    await loadTechCards();
  }

  /** Merge one parsed file into a session draft. */
  function applyFile(
    draft: Session,
    name: string,
    parsed: { qly?: QlyEntry[]; ini?: ClassIniMeta; datRuns?: AccutimeRun[]; warning?: string },
  ) {
    draft.files.push(name);
    if (parsed.warning) draft.warnings.push(parsed.warning);
    if (parsed.qly) draft.qly = parsed.qly;
    if (parsed.ini) draft.ini = parsed.ini;
    if (parsed.datRuns) draft.datRuns = parsed.datRuns;
  }

  function finalizeDefaults(draft: Session, nextChannel: number) {
    if (!draft.classCode && draft.ini?.classCode) draft.classCode = draft.ini.classCode;
    if (!draft.className) draft.className = draft.classCode ? classNameFromCode(draft.classCode) : "";
    if (!draft.channel) draft.channel = nextChannel;
    if (!draft.fieldSize) {
      const fs = fieldSizeForClassName(draft.className);
      draft.fieldSize = fs ? String(fs) : "";
    }
    if (!draft.sessionLabel) {
      const fromIni = draft.ini?.sessions;
      const fromQly = draft.qly?.find((e) => e.totalSessions)?.totalSessions;
      const fromDat = draft.datRuns
        ? Math.max(0, ...draft.datRuns.filter((r) => r.raceType === 0).map((r) => r.roundNumber))
        : 0;
      const n = fromIni || fromQly || fromDat;
      draft.sessionLabel = n ? `Q${n}` : "";
    }
    if (draft.datRuns) draft.treeBase = defaultTreeBase(draft.datRuns);
  }

  async function parseOneFile(name: string, bytes: Uint8Array): Promise<{ qly?: QlyEntry[]; ini?: ClassIniMeta; datRuns?: AccutimeRun[]; warning?: string } | null> {
    const lower = name.toLowerCase();
    const asText = () => new TextDecoder("latin1").decode(bytes);

    if (lower.endsWith(".dbf")) {
      return { warning: `${name}: driver directory skipped (proprietary) — tech cards cover the same fields.` };
    }
    if (lower.endsWith(".dat")) {
      const form = new FormData();
      form.append("file", new File([bytes as BlobPart], name));
      const res = await fetch("/api/accutime-dat", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) return { warning: `${name}: ${body.error || "could not read"}` };
      return { datRuns: body.runs as AccutimeRun[] };
    }
    if (lower.endsWith(".ini")) {
      return { ini: parseClassIni(asText()) };
    }
    if (lower.endsWith(".qly") || lower.endsWith(".csv") || lower.endsWith(".txt")) {
      const text = asText();
      if (looksLikeQly(text)) return { qly: parseQly(text) };
      if (lower.endsWith(".qly")) return { warning: `${name}: doesn't look like an AccuTime .qly list.` };
      return null;
    }
    return null;
  }

  async function handleFiles(files: File[], sessionId?: string) {
    if (files.length === 0) return;
    setBusy(true);
    setPageError("");
    try {
      // Explode zips first (.acc is a password-protected zip — flagged, not read).
      const flat: { name: string; bytes: Uint8Array }[] = [];
      const warnings: string[] = [];
      for (const f of files) {
        const lower = f.name.toLowerCase();
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (lower.endsWith(".zip") || lower.endsWith(".acc")) {
          try {
            const entries = unzipSync(bytes);
            for (const [entryName, entryBytes] of Object.entries(entries)) {
              if (entryName.endsWith("/")) continue;
              flat.push({ name: entryName.split("/").pop() || entryName, bytes: entryBytes });
            }
          } catch {
            warnings.push(
              lower.endsWith(".acc")
                ? `${f.name}: .acc archives are password-encrypted — drop the loose race.qly / race.dat / Class.ini instead.`
                : `${f.name}: could not open the zip.`,
            );
          }
          continue;
        }
        flat.push({ name: f.name, bytes });
      }

      const existing = sessionId ? sessions.find((s) => s.id === sessionId) : undefined;
      const draft: Session = existing
        ? { ...existing, files: [...existing.files], warnings: [...existing.warnings, ...warnings] }
        : {
            id: `s${++seq.current}_${Date.now()}`,
            className: "",
            classCode: "",
            channel: 0,
            fieldSize: "",
            sessionLabel: "",
            treeBase: 0.4,
            qly: null,
            datRuns: null,
            ini: null,
            files: [],
            warnings,
            selected: true,
          };

      let recognized = 0;
      for (const { name, bytes } of flat) {
        const parsed = await parseOneFile(name, bytes);
        if (parsed) {
          applyFile(draft, name, parsed);
          if (!parsed.warning) recognized++;
        }
      }
      if (recognized === 0 && draft.files.length === 0) {
        setPageError("Nothing usable in that drop — expected race.qly, race.dat, Class.ini (or a zip of them).");
        return;
      }
      const usedChannels = sessions.filter((s) => s.id !== draft.id).map((s) => s.channel);
      finalizeDefaults(draft, usedChannels.length ? Math.max(...usedChannels) + 1 : 1);

      setSessions((prev) => {
        const others = prev.filter((s) => s.id !== draft.id);
        const idx = prev.findIndex((s) => s.id === draft.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = draft;
          return copy;
        }
        return [...others, draft];
      });
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function updateSession(id: string, patch: Partial<Session>) {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  // ——— Builders ———

  function qdatFor(s: Session): QdatFile | null {
    const entries = s.qly ?? (s.datRuns ? qualifyingFromDatRuns(s.datRuns) : null);
    if (!entries || entries.length === 0) return null;
    return buildQdatFile(entries, techCards, {
      category: s.className || s.classCode || "UNKNOWN CLASS",
      classCode: s.classCode || "X",
      channel: s.channel,
      indexByCar: s.datRuns ? indexByCarFromQualRuns(s.datRuns) : undefined,
    });
  }

  function edatFor(s: Session): { filename: string; content: string; rounds: string[]; enriched: number; runs: number } | null {
    if (!s.datRuns) return null;
    const qualPosByCar = s.qly ? new Map(s.qly.map((e) => [e.car.toUpperCase(), e.position])) : undefined;
    const rows = accutimeRunsToRunRows(s.datRuns, {
      category: s.className || s.classCode || "UNKNOWN CLASS",
      treeBase: s.treeBase,
      qualPosByCar,
    });
    const result = buildEdataExport(rows, techCards);
    if (result.files.length === 0) return null;
    const f = result.files[0];
    return {
      filename: `C${s.channel}EDAT.TXT`,
      content: f.content,
      rounds: f.rounds,
      enriched: f.enriched,
      runs: f.runs,
    };
  }

  const selected = sessions.filter((s) => s.selected);

  function downloadQdat() {
    const files = selected
      .map((s) => qdatFor(s))
      .filter((f): f is QdatFile => !!f);
    if (files.length === 0) return;
    if (files.length === 1) {
      downloadBytes(files[0].filename, fileBytes(files[0].content), "text/plain");
      return;
    }
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) entries[f.filename] = fileBytes(f.content);
    downloadBytes("RACEDATA-QDAT.zip", zipSync(entries), "application/zip");
  }

  function downloadEdat() {
    const files = selected.map((s) => edatFor(s)).filter((f): f is NonNullable<ReturnType<typeof edatFor>> => !!f);
    if (files.length === 0) return;
    if (files.length === 1) {
      downloadBytes(files[0].filename, fileBytes(files[0].content), "text/plain");
      return;
    }
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) entries[f.filename] = fileBytes(f.content);
    downloadBytes("RACEDATA-EDAT.zip", zipSync(entries), "application/zip");
  }

  async function downloadQualifyingPdf() {
    const classes = selected
      .map((s) => ({ s, qdat: qdatFor(s) }))
      .filter((x): x is { s: Session; qdat: QdatFile } => !!x.qdat)
      .map(({ s, qdat }) => ({
        qdat,
        sessionLabel: s.sessionLabel,
        fieldSize: parseInt(s.fieldSize, 10) > 0 ? parseInt(s.fieldSize, 10) : null,
      }));
    if (classes.length === 0) return;
    const { buildQualifyingPdf } = await import("@/lib/qualifying-pdf");
    const doc = buildQualifyingPdf(classes, {
      track: header.track,
      city: header.city,
      sanction: "NHRA",
      division: header.division,
      eventName: header.eventName,
      dateStr: header.roundDate || roundDateFromIso(selected.find((s) => s.ini?.raceDate)?.ini?.raceDate || ""),
      timeStr: nowTimeStr(),
    });
    doc.save(`Qualifying-${(header.track || "event").replace(/[^A-Za-z0-9]+/g, "-")}.pdf`);
  }

  async function downloadFinalRoundPdf() {
    const channels: Record<number, { EDAT?: string; QDAT?: string }> = {};
    for (const s of selected) {
      const q = qdatFor(s);
      const e = edatFor(s);
      if (!q && !e) continue;
      channels[s.channel] = { EDAT: e?.content, QDAT: q?.content };
    }
    if (Object.keys(channels).length === 0) return;
    const { buildFinalRoundPdf } = await import("@/lib/final-round-pdf");
    const doc = buildFinalRoundPdf(channels, {
      dates: header.eventDates,
      track: header.track,
      location: header.city,
      series: (header.eventName || "").toUpperCase(),
      roundDate: header.roundDate || roundDateFromIso(selected.find((s) => s.ini?.raceDate)?.ini?.raceDate || ""),
    });
    doc.save(`Final-Round-Results-${(header.track || "event").replace(/[^A-Za-z0-9]+/g, "-")}.pdf`);
  }

  const headerInput = (label: string, key: keyof HeaderFields, placeholder: string) => (
    <label className="text-xs text-gray-400">
      {label}
      <input
        value={header[key]}
        onChange={(e) => setHeader((h) => ({ ...h, [key]: e.target.value }))}
        placeholder={placeholder}
        className="mt-1 w-full px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white placeholder-gray-600"
      />
    </label>
  );

  return (
    <div className="max-w-5xl mx-auto pb-16">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">AccuTime Export</h1>
        <p className="text-gray-400 max-w-3xl">
          Turn AccuTime session files into Compulink StarTrak outputs: QDAT qualifying data, EDAT
          elimination results, the StarTrak qualifying listing PDF, and the Final Round Results PDF.
          Drop one session set (race.qly, race.dat, Class.ini) per class.
        </p>
      </div>

      {/* Tech cards — same import/store the EDAT export uses. */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-white font-bold">Tech cards</h2>
            <p className="text-xs text-gray-400 mt-0.5 max-w-xl">
              Member numbers, full names, hometowns, car bodies and motors merge into every output
              from the tech-card store (matched per class by car number, then driver name).
              {" "}{techStatus}
            </p>
          </div>
          <button
            onClick={() => techFileRef.current?.click()}
            disabled={techUploading}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-nhra-darker border border-nhra-border text-gray-300 hover:text-white disabled:opacity-40"
          >
            {techUploading ? "Importing…" : "Import tech cards"}
          </button>
          <input
            ref={techFileRef}
            type="file"
            multiple
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => handleTechUpload(Array.from(e.target.files || []))}
          />
        </div>
      </div>

      {/* Session drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(Array.from(e.dataTransfer.files));
        }}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl px-6 py-10 text-center cursor-pointer transition-colors mb-6 ${
          dragOver ? "border-nhra-red bg-nhra-red/5" : "border-nhra-border hover:border-gray-600"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".qly,.dat,.ini,.csv,.txt,.zip,.acc,.dbf"
          className="hidden"
          onChange={(e) => handleFiles(Array.from(e.target.files || []))}
        />
        <p className="text-white font-medium mb-1">
          {busy ? "Reading AccuTime files…" : "Drop an AccuTime session here (one class per drop)"}
        </p>
        <p className="text-xs text-gray-500">
          race.qly (qualifying list) · race.dat (rounds — Jet database, read as-is) · Class.ini
          (class + event metadata) · or a plain zip of them. The encrypted .acc can&apos;t be read.
        </p>
      </div>

      {pageError && (
        <div className="mb-6 bg-red-500/10 border border-red-500/40 text-red-400 rounded-xl px-4 py-3 text-sm">
          {pageError}
        </div>
      )}

      {/* Event header for the PDFs */}
      {sessions.length > 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
          <h2 className="text-white font-bold mb-3">Event header (printed on the PDFs)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {headerInput("Track", "track", "US 131 Motorsports Park")}
            {headerInput("City, State", "city", "Martin, MI")}
            {headerInput("Division line", "division", "DIVISION 3")}
            {headerInput("Event / series name", "eventName", "NHRA Mission Foods Drag Racing Series")}
            {headerInput("Event dates", "eventDates", "September 18-21, 2026")}
            {headerInput("Round date", "roundDate", "21/SEP/2026")}
          </div>
        </div>
      )}

      {/* Sessions */}
      {sessions.map((s) => {
        const qdat = qdatFor(s);
        const edat = edatFor(s);
        return (
          <div
            key={s.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFiles(Array.from(e.dataTransfer.files), s.id);
            }}
            className={`bg-nhra-card border rounded-xl p-5 mb-4 ${s.selected ? "border-nhra-red/40" : "border-nhra-border"}`}
          >
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={s.selected}
                  onChange={(e) => updateSession(s.id, { selected: e.target.checked })}
                  className="accent-nhra-red w-4 h-4"
                />
                <div>
                  <span className="text-white font-bold text-lg">{s.className || "Class"}</span>
                  <span className="text-gray-500 text-sm ml-2">
                    {s.files.join(" · ") || "no files"}
                  </span>
                </div>
              </label>
              <button
                onClick={() => setSessions((prev) => prev.filter((x) => x.id !== s.id))}
                className="text-xs text-gray-500 hover:text-red-400"
              >
                Remove
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mb-3">
              <label className="text-xs text-gray-400 col-span-2">
                Class name
                <input
                  value={s.className}
                  onChange={(e) => updateSession(s.id, { className: e.target.value })}
                  className="mt-1 w-full px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white"
                />
              </label>
              <label className="text-xs text-gray-400">
                Code
                <input
                  value={s.classCode}
                  onChange={(e) => updateSession(s.id, { classCode: e.target.value.toUpperCase() })}
                  className="mt-1 w-full px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white"
                />
              </label>
              <label className="text-xs text-gray-400">
                C# channel
                <input
                  type="number"
                  min={1}
                  value={s.channel}
                  onChange={(e) => updateSession(s.id, { channel: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  className="mt-1 w-full px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white"
                />
              </label>
              <label className="text-xs text-gray-400">
                Field size
                <input
                  value={s.fieldSize}
                  onChange={(e) => updateSession(s.id, { fieldSize: e.target.value })}
                  placeholder="16"
                  className="mt-1 w-full px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white"
                />
              </label>
              <label className="text-xs text-gray-400">
                Session
                <input
                  value={s.sessionLabel}
                  onChange={(e) => updateSession(s.id, { sessionLabel: e.target.value })}
                  placeholder="Q4"
                  className="mt-1 w-full px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white"
                />
              </label>
            </div>

            {s.datRuns && (
              <label className="text-xs text-gray-400 flex items-center gap-2 mb-3">
                Tree base (AccuTime logs tree-inclusive reaction times; Compulink prints from green)
                <select
                  value={String(s.treeBase)}
                  onChange={(e) => updateSession(s.id, { treeBase: parseFloat(e.target.value) })}
                  className="px-2 py-1 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white"
                >
                  <option value="0.4">Pro tree (−0.400)</option>
                  <option value="0.5">Full tree (−0.500)</option>
                  <option value="0">Keep raw</option>
                </select>
              </label>
            )}

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400">
              <span>
                Qualifying: {qdat ? `${qdat.qualified} entries${s.qly ? " (.qly order)" : " (from .dat sessions)"}` : "—"}
              </span>
              <span>Eliminations: {edat ? `${edat.rounds.join(" · ")} (${edat.runs} runs)` : "—"}</span>
              <span title="Runs whose entry fields came from a tech card">
                Tech cards: {qdat || edat ? `${(qdat?.enriched || 0) + (edat?.enriched || 0)}/${(qdat?.rows.length || 0) + (edat?.runs || 0)}` : "—"}
              </span>
              {qdat && (
                <button
                  onClick={() => downloadBytes(qdat.filename, fileBytes(qdat.content), "text/plain")}
                  className="text-nhra-accent hover:text-white font-mono"
                >
                  {qdat.filename}
                </button>
              )}
              {edat && (
                <button
                  onClick={() => downloadBytes(edat.filename, fileBytes(edat.content), "text/plain")}
                  className="text-nhra-accent hover:text-white font-mono"
                >
                  {edat.filename}
                </button>
              )}
            </div>

            {s.warnings.length > 0 && (
              <ul className="mt-3 text-xs text-yellow-500/90 list-disc list-inside space-y-0.5">
                {s.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {/* Export actions */}
      {sessions.length > 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-5">
          <h2 className="text-white font-bold mb-1">
            Export {selected.length} of {sessions.length} class{sessions.length === 1 ? "" : "es"}
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Files download singly, or zipped when several classes are ticked. QDAT/EDAT are CRLF,
            latin1, 0x1A-padded to 128-byte blocks — the exact shape real Compulink disks carry.
            The Final Round Results PDF is built from those same files, so it always matches them.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={downloadQdat}
              disabled={selected.every((s) => !qdatFor(s))}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-nhra-red text-white hover:bg-red-600 disabled:opacity-40"
            >
              Download QDAT
            </button>
            <button
              onClick={downloadEdat}
              disabled={selected.every((s) => !edatFor(s))}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-nhra-red text-white hover:bg-red-600 disabled:opacity-40"
            >
              Download EDAT
            </button>
            <button
              onClick={downloadQualifyingPdf}
              disabled={selected.every((s) => !qdatFor(s))}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-nhra-darker border border-nhra-border text-gray-200 hover:text-white disabled:opacity-40"
            >
              Qualifying Listing PDF
            </button>
            <button
              onClick={downloadFinalRoundPdf}
              disabled={selected.every((s) => !qdatFor(s) && !edatFor(s))}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-nhra-darker border border-nhra-border text-gray-200 hover:text-white disabled:opacity-40"
            >
              Final Round Results PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
