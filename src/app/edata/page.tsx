"use client";

import { useEffect, useRef, useState } from "react";
import { strToU8, zipSync } from "fflate";
import { useLiveData } from "@/components/LiveDataProvider";
import { RACE_CLASSES } from "@/lib/schedule-classes";
import {
  DEDUCTION_REASONS,
  PRO_EVENT_SCALES,
  buildDeductionsSheet,
  buildPointsFileContent,
  deductionsFor,
  proScaleLabel,
  type AccuPointsCategory,
  type AccuPointsSkipped,
  type PointsDeduction,
  type ProEventScale,
} from "@/lib/accutime-points";

// Class picker options for sessions whose Class.ini carries no code: real
// racing classes only (the schedule placeholders — Secure "X", Track Prep… —
// are not timing classes), one entry per code.
const ACCU_CLASS_OPTIONS: { code: string; name: string }[] = (() => {
  const seen = new Set<string>();
  const out: { code: string; name: string }[] = [];
  for (const c of RACE_CLASSES) {
    if (!c.isRacing) continue;
    const code = c.code.trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name: c.name.toUpperCase() });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
})();

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
  seriesName: string | null;
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

// Full parsed session data as the server returns it (`sessionsFull`). Opaque
// on the client: it's saved locally and posted back as `prior_sessions` so the
// next drop MERGES into the pack instead of replacing it.
type AccuStoredSession = { classCode: string; className: string } & Record<string, unknown>;

interface AccuMergeInfo {
  added: string[];
  replaced: string[];
}

interface AccuResult {
  sessions: AccuSession[];
  edat: (AccuTextFile & { content: string })[];
  qdat: (AccuTextFile & { content: string })[];
  finalsPdfBase64: string | null;
  qualifyingPdfBase64: string | null;
  coverage: { category: string; enriched: number; runs: number }[];
  points: AccuPointsCategory[];
  pointsSkipped: AccuPointsSkipped[];
  idx: (AccuTextFile & { content: string }) | null;
  sessionsFull?: AccuStoredSession[];
  merge?: AccuMergeInfo;
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

interface AccuEntry {
  file: File;
  path: string;
}

// ——— Header logos: the racedata-zip-to-pdf three-slot row (left / event /
// right), stamped across the top of the qualifying + Final Round Results
// PDFs. Kept in localStorage so the logos survive a refresh. ———

type AccuLogoSlot = "left" | "center" | "right";

const ACCU_LOGO_SLOTS: { key: AccuLogoSlot; label: string; align: string }[] = [
  { key: "left", label: "Click to add left logo", align: "justify-start" },
  { key: "center", label: "Click to add event logo", align: "justify-center" },
  { key: "right", label: "Click to add right logo", align: "justify-end" },
];

const ACCU_LOGOS_LS_KEY = "timindata_accutime_logos";

/** One string per logo set, to tell whether the built package already has them. */
function logosKey(l: Record<AccuLogoSlot, string | null>): string {
  return `${l.left || ""}|${l.center || ""}|${l.right || ""}`;
}

// ——— Local class pack: the accumulated AccuTime working set. Mark drops one
// class at a time (FC now, TF later), so the parsed sessions plus the built
// package are saved in the browser and survive a refresh; each new drop posts
// the saved sessions back and the server merges by class. IndexedDB rather
// than localStorage — the built package (base64 PDFs included) easily outgrows
// the ~5 MB localStorage quota the logos live in. ———

const ACCU_PACK_DB = "timindata_accutime_pack";
const ACCU_PACK_STORE = "pack";
const ACCU_PACK_KEY = "working_set";

interface AccuPackStored {
  v: 1;
  savedAt: number;
  sessions: AccuStoredSession[];
  result: AccuResult;
  series: string;
  builtLogosKey: string | null;
}

function openAccuPackDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ACCU_PACK_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(ACCU_PACK_STORE)) {
        req.result.createObjectStore(ACCU_PACK_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// All three swallow storage failures: without IndexedDB the page still works,
// the pack just doesn't survive a refresh.
async function loadAccuPack(): Promise<AccuPackStored | null> {
  try {
    const db = await openAccuPackDb();
    try {
      const stored = await new Promise<unknown>((resolve, reject) => {
        const req = db.transaction(ACCU_PACK_STORE, "readonly").objectStore(ACCU_PACK_STORE).get(ACCU_PACK_KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const p = stored as AccuPackStored | undefined;
      if (!p || p.v !== 1 || !Array.isArray(p.sessions) || !p.result || typeof p.result !== "object") return null;
      return p;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function saveAccuPack(pack: AccuPackStored): Promise<void> {
  try {
    const db = await openAccuPackDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(ACCU_PACK_STORE, "readwrite");
        tx.objectStore(ACCU_PACK_STORE).put(pack, ACCU_PACK_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // quota / private mode — the pack still lives in page state for this visit
  }
}

async function clearAccuPack(): Promise<void> {
  try {
    const db = await openAccuPackDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(ACCU_PACK_STORE, "readwrite");
        tx.objectStore(ACCU_PACK_STORE).delete(ACCU_PACK_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // nothing stored to clear
  }
}

// Rasterize any picked image (PNG / JPG / WebP / SVG) to a PNG/JPEG data URL
// jsPDF can embed. The server rejects logo fields over ~3M chars, so the
// encode steps down — smaller PNG, then JPEG flattened onto white (the PDF
// page is white anyway) — until the data URL fits with room to spare. Without
// this, a photo-style banner rasterized to PNG could blow past the cap and
// the logo silently vanished from the downloaded PDFs.
const LOGO_DATA_URL_MAX = 2_500_000;

async function fileToLogoDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("unreadable image"));
      el.src = url;
    });
    const natW = img.naturalWidth || 600;
    const natH = img.naturalHeight || 210;
    const base = Math.min(1, 1600 / natW, 420 / natH);
    const render = (scale: number, type: "image/png" | "image/jpeg"): string => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(natW * scale));
      canvas.height = Math.max(1, Math.round(natH * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      if (type === "image/jpeg") {
        // JPEG has no alpha — flatten onto white, matching the printed sheet.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL(type, 0.85);
    };
    // PNG keeps transparency; only give that up when even a half-size PNG is
    // still too heavy.
    for (const s of [1, 0.7, 0.5]) {
      const out = render(base * s, "image/png");
      if (out.length <= LOGO_DATA_URL_MAX) return out;
    }
    for (const s of [1, 0.7, 0.5]) {
      const out = render(base * s, "image/jpeg");
      if (out.length <= LOGO_DATA_URL_MAX) return out;
    }
    return render(base * 0.25, "image/jpeg");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Folder drops arrive as directory entries, and which folder a file came from
// is a class-grouping signal server-side — so the drop is walked recursively
// and every file keeps its relative path.
async function collectAccuDrop(dt: DataTransfer): Promise<AccuEntry[]> {
  const entries = Array.from(dt.items || []).map((it) =>
    typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null,
  );
  if (!entries.some(Boolean)) {
    return Array.from(dt.files).map((f) => ({ file: f, path: f.webkitRelativePath || f.name }));
  }
  const out: AccuEntry[] = [];
  async function walk(entry: FileSystemEntry, prefix: string): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) =>
        (entry as FileSystemFileEntry).file(res, rej),
      );
      out.push({ file, path: prefix + entry.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns results in chunks — keep reading until empty.
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${prefix + entry.name}/`);
      } while (batch.length > 0);
    }
  }
  for (const e of entries) if (e) await walk(e, "");
  return out;
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
  // The accumulated class pack: every parsed session so far, as the server
  // returned it. Posted back with each drop so the server merges instead of
  // replacing, and enough on its own to rebuild the package (picked class,
  // edited series header, changed logos) without re-dropping any files.
  const [accuSessions, setAccuSessions] = useState<AccuStoredSession[]>([]);
  const [accuMerge, setAccuMerge] = useState<AccuMergeInfo | null>(null);
  const [accuSeries, setAccuSeries] = useState("");
  const accuSeriesEdited = useRef(false);
  const [accuClassPick, setAccuClassPick] = useState("");
  const [accuLogos, setAccuLogos] = useState<Record<AccuLogoSlot, string | null>>({
    left: null,
    center: null,
    right: null,
  });
  const accuLogoInputRef = useRef<HTMLInputElement>(null);
  const accuLogoSlotRef = useRef<AccuLogoSlot>("left");
  // The logos baked into the current package's PDFs. The server renders the
  // PDFs at upload time, so when the on-page logos drift from these the
  // package must be rebuilt or the download buttons keep serving PDFs without
  // the logos (the v1.43.1 "images don't go on the finals PDF" bug).
  const accuBuiltLogosKey = useRef<string | null>(null);

  // Points (Alcohol & below) + deductions. Deductions live in page state for
  // the session and are applied client-side, so adding one needs no rebuild.
  const [accuCalcPoints, setAccuCalcPoints] = useState(true);
  const [accuIncomplete, setAccuIncomplete] = useState(false);
  // Event scale for pro (Mission Foods) classes: Indy and the Pomona 2
  // Countdown finale pay the stepped-up values; everything else is regular.
  const [accuProScale, setAccuProScale] = useState<ProEventScale>("regular");
  // Race code in the points filename: "16" → C10A16DP.TXT (golden sample).
  const [accuRaceCode, setAccuRaceCode] = useState("16");
  const [accuDeductions, setAccuDeductions] = useState<(PointsDeduction & { id: number })[]>([]);
  const dedId = useRef(1);
  const [dedCat, setDedCat] = useState("");
  const [dedCar, setDedCar] = useState("");
  const [dedReason, setDedReason] = useState<string>(DEDUCTION_REASONS[0]);
  const [dedNote, setDedNote] = useState("");
  const [dedPoints, setDedPoints] = useState("");

  function addDeduction() {
    const cat = accuResult?.points.find((p) => p.category === dedCat);
    const row = cat?.rows.find((r) => r.car_number === dedCar);
    const pts = parseFloat(dedPoints);
    if (!cat || !row || !Number.isFinite(pts) || pts <= 0) return;
    setAccuDeductions((prev) => [
      ...prev,
      {
        id: dedId.current++,
        category: cat.category,
        car_number: row.car_number,
        name: row.name,
        reason: dedReason,
        note: dedNote.trim(),
        points: pts,
      },
    ]);
    setDedNote("");
    setDedPoints("");
  }

  /** A category's rows with deductions applied (final = points − deducted). */
  function pointsRowsFinal(cat: AccuPointsCategory) {
    return cat.rows.map((r) => {
      const deducted = deductionsFor(accuDeductions, cat.category, r.car_number);
      return { ...r, deducted, final: r.points - deducted };
    });
  }

  // Points files: earned points in field 5, the deduction in field 6 (the
  // golden A16DP layout), so the audit trail lives in the file itself.
  function pointsFileEntries(): Record<string, Uint8Array> {
    const entries: Record<string, Uint8Array> = {};
    if (!accuResult) return entries;
    for (const cat of accuResult.points) {
      const rows = pointsRowsFinal(cat).map((r) => ({ ...r, deduction: r.deducted }));
      entries[cat.filename] = edataBytes(buildPointsFileContent(cat.category, rows));
    }
    return entries;
  }

  /** Deductions that actually hit a scored row — the notes audit sheet. */
  function appliedDeductions() {
    if (!accuResult) return [];
    return accuDeductions.filter((d) =>
      accuResult.points.some(
        (p) => p.category === d.category && p.rows.some((r) => r.car_number === d.car_number),
      ),
    );
  }

  // Restore the last-used header logos.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ACCU_LOGOS_LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<AccuLogoSlot, unknown>>;
      const pick = (v: unknown) => (typeof v === "string" && v.startsWith("data:image/") ? v : null);
      setAccuLogos({ left: pick(parsed.left), center: pick(parsed.center), right: pick(parsed.right) });
    } catch {
      // corrupt store — start clean
    }
  }, []);

  // Rehydrate the saved class pack, so a refresh — or coming back after
  // dropping Funny Car this morning — keeps every class already built.
  useEffect(() => {
    let cancelled = false;
    void loadAccuPack().then((pack) => {
      if (cancelled || !pack) return;
      setAccuSessions(pack.sessions);
      setAccuResult(pack.result);
      accuBuiltLogosKey.current = pack.builtLogosKey;
      if (pack.series && !accuSeriesEdited.current) setAccuSeries(pack.series);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Adding, replacing or clearing a logo after the package was built rebuilds
  // it automatically (debounced), so the downloaded finals / qualifying PDFs
  // always carry the logos shown on the page. Rebuilds run from the saved
  // sessions — no files needed, so this works after a refresh too.
  useEffect(() => {
    if (!accuResult || accuUploading || accuSessions.length === 0) return;
    if (accuBuiltLogosKey.current === null) return;
    if (logosKey(accuLogos) === accuBuiltLogosKey.current) return;
    const t = setTimeout(() => void postAccuBuild([]), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accuLogos, accuResult, accuUploading, accuSessions]);

  function updateLogo(slot: AccuLogoSlot, dataUrl: string | null) {
    const next = { ...accuLogos, [slot]: dataUrl };
    setAccuLogos(next);
    try {
      localStorage.setItem(ACCU_LOGOS_LS_KEY, JSON.stringify(next));
    } catch {
      // quota full — the logos still apply for this session
    }
  }

  async function handleLogoPick(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    try {
      updateLogo(accuLogoSlotRef.current, await fileToLogoDataUrl(f));
    } catch {
      setAccuError(`${f.name}: couldn't be read as an image.`);
    } finally {
      if (accuLogoInputRef.current) accuLogoInputRef.current.value = "";
    }
  }

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

  async function handleAccuUpload(entries: AccuEntry[]) {
    // .acc is AccuTime's password-locked archive — it can't be opened here, so
    // it's dropped from the upload with a note rather than failing everything.
    const accFiles = entries.filter((e) => /\.acc$/i.test(e.path));
    const valid = entries.filter((e) => /\.(dat|qly|ini|dbf|zip|txt)$/i.test(e.path));
    setAccuNote(
      accFiles.length > 0
        ? `${accFiles.map((e) => e.file.name).join(", ")} skipped — AccuTime .acc archives are password-locked. Use the loose .qly / .dat / Class.ini / Drivers.dbf files from the same folder instead.`
        : "",
    );
    if (valid.length === 0) {
      setAccuError(
        accFiles.length > 0
          ? ""
          : "Upload AccuTime session files (.dat / .qly / Class.ini / Drivers.dbf), Compulink C#QDAT/C#EDAT .TXT, or a zip of them.",
      );
      if (accuFileRef.current) accuFileRef.current.value = "";
      return;
    }
    await postAccuBuild(valid);
  }

  // One request, two shapes: new files merge into the saved pack; no files is
  // a pure rebuild of the pack (class pick, series header, logo changes). The
  // previous result stays on screen until the new one lands, so a failed
  // request never blanks a working package.
  async function postAccuBuild(valid: AccuEntry[]) {
    // A drop landing while another is in flight would post a stale pack and
    // silently lose the in-flight class — make it wait instead.
    if (accuUploading) return;
    const isUpload = valid.length > 0;
    setAccuUploading(true);
    setAccuError("");
    setAccuMerge(null);
    setAccuProgress({
      stage: isUpload ? "Uploading session files…" : "Rebuilding from saved class data…",
      pct: isUpload ? 0 : null,
    });
    try {
      const form = new FormData();
      // The relative path rides along as the filename — which folder a file
      // came from tells the server which class session it belongs to.
      for (const e of valid) form.append("files", e.file, e.path);
      // The saved pack goes with every request, so the server merges the new
      // drop into it (same class → replaced, new class → added).
      if (accuSessions.length > 0) form.append("prior_sessions", JSON.stringify(accuSessions));
      if (live.config?.eventName) form.append("event_name", live.config.eventName);
      if (eventCode.trim()) form.append("event_code", eventCode.trim());
      if (season.trim()) form.append("season", season.trim());
      if (accuClassPick) form.append("class_code", accuClassPick);
      if (accuSeries.trim()) form.append("series_header", accuSeries.trim());
      if (accuLogos.left) form.append("logo_left", accuLogos.left);
      if (accuLogos.center) form.append("logo_center", accuLogos.center);
      if (accuLogos.right) form.append("logo_right", accuLogos.right);
      // Recorded at attempt time (not on success) so a failed rebuild shows
      // its error once instead of retry-looping from the auto-rebuild effect.
      accuBuiltLogosKey.current = logosKey(accuLogos);
      form.append("calc_points", accuCalcPoints ? "1" : "0");
      form.append("incomplete_race", accuIncomplete ? "1" : "0");
      form.append("pro_scale", accuProScale);
      form.append("points_race_code", accuRaceCode.trim());
      const { ok, body } = await postAccuForm(form, (pct) => {
        if (pct !== null && pct < 1) {
          setAccuProgress({
            stage: isUpload ? "Uploading session files…" : "Sending saved class data…",
            pct: isUpload ? pct : null,
          });
        } else {
          // Bytes are up — everything left is server work with no size to count.
          setAccuProgress({ stage: "Reading session · building QDAT / EDAT / PDFs…", pct: null });
        }
      });
      if (!ok) throw new Error((body.error as string) || "AccuTime export failed");
      const parsed = body as unknown as AccuResult;
      const sessionsFull = Array.isArray(parsed.sessionsFull) ? parsed.sessionsFull : [];
      setAccuResult(parsed);
      setAccuSessions(sessionsFull);
      setAccuMerge(isUpload && parsed.merge ? parsed.merge : null);
      // Prefill the header field with the session's own series title (Class.ini
      // [Reports]) unless the user already typed one.
      let series = accuSeries;
      if (!accuSeriesEdited.current) {
        const s = parsed.sessions.find((x) => x.seriesName)?.seriesName;
        if (s) {
          series = s;
          setAccuSeries(s);
        }
      }
      // Persist the whole working set — the pack survives a refresh until
      // Clear data. sessionsFull is stored under its own key, not twice.
      const { sessionsFull: _omit, ...resultLean } = parsed;
      void saveAccuPack({
        v: 1,
        savedAt: Date.now(),
        sessions: sessionsFull,
        result: resultLean as AccuResult,
        series,
        builtLogosKey: accuBuiltLogosKey.current,
      });
    } catch (err) {
      setAccuError(err instanceof Error ? err.message : "AccuTime export failed");
    } finally {
      setAccuUploading(false);
      setAccuProgress(null);
      if (accuFileRef.current) accuFileRef.current.value = "";
    }
  }

  // Clear data: wipe the accumulated classes + built package (local storage
  // and page state) for a fresh event. Header logos deliberately stay — they
  // live in their own store and carry over between events.
  function handleAccuClearData() {
    if (!window.confirm("Clear all AccuTime race data saved in this browser? Every class in the pack and the built package go away. Header logos stay.")) {
      return;
    }
    setAccuResult(null);
    setAccuSessions([]);
    setAccuMerge(null);
    setAccuError("");
    setAccuNote("");
    setAccuDeductions([]);
    setDedCat("");
    setDedCar("");
    setAccuClassPick("");
    setAccuSeries("");
    accuSeriesEdited.current = false;
    accuBuiltLogosKey.current = null;
    void clearAccuPack();
  }

  // RACEDATA.zip is Compulink text only — per class C#QDAT / C#EDAT /
  // C#A16DP plus IDX14.TXT, matching the golden sample. PDFs download
  // separately, never inside this zip.
  function accuAllEntries(): Record<string, Uint8Array> {
    const entries: Record<string, Uint8Array> = {};
    if (!accuResult) return entries;
    for (const f of accuResult.edat) entries[f.filename] = edataBytes(f.content);
    for (const f of accuResult.qdat) entries[f.filename] = edataBytes(f.content);
    Object.assign(entries, pointsFileEntries());
    if (accuResult.idx) entries[accuResult.idx.filename] = edataBytes(accuResult.idx.content);
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
            Drop AccuTime sessions and get the full package: Compulink-compatible qualifying{" "}
            <span className="font-mono">*QDAT.TXT</span>, eliminations{" "}
            <span className="font-mono">*EDAT.TXT</span> and EVENT points{" "}
            <span className="font-mono">*A16DP.TXT</span>, plus an AccuTime-branded qualifying PDF
            and Final Round Results PDF (with each class&apos;s round-by-round elimination page).
            Upload the <span className="font-mono">.dat</span> /{" "}
            <span className="font-mono">.qly</span> / <span className="font-mono">Class.ini</span>{" "}
            / <span className="font-mono">Drivers.dbf</span> files from the session folder (a zip
            works too) — or, for tracks that already have Compulink text, drop{" "}
            <span className="font-mono">C#QDAT.TXT</span> +{" "}
            <span className="font-mono">C#EDAT.TXT</span> directly for the same package. The{" "}
            <span className="font-mono">.acc</span> archive is password-locked and isn&apos;t
            needed — the loose files carry the same data. Several classes can go in one drop:
            one folder or zip per class, or matching names (FC.dat + FC.qly + FC-Class.ini).
            Member #, city, body and engine merge from the session&apos;s own driver database and
            the shared tech cards. RACEDATA.zip holds the Compulink text only (QDAT / EDAT /
            points / IDX); the PDFs download separately. Drops <em>accumulate</em>: each upload
            merges into the pack saved in this browser — drop Funny Car now and Top Fuel later
            and both stay in, re-dropping a class replaces just that class, and the zip and
            PDFs always build from everything. Hit Clear data to start a new event.
          </p>
        </div>

        {/* Header logos — the same three-slot row as the Final Round Results
            Builder, printed across the top of both PDFs. */}
        <input
          ref={accuLogoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handleLogoPick(e.target.files)}
        />
        <p className="text-xs text-gray-400 mb-1.5">
          Sheet header logos <span className="text-gray-500">— print across the top of the qualifying and Final Round Results PDFs; leave empty for text-only headers. Changing them after an upload rebuilds the package automatically.</span>
        </p>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {ACCU_LOGO_SLOTS.map((slot) => {
            const img = accuLogos[slot.key];
            return (
              <div key={slot.key} className="relative group">
                <button
                  onClick={() => {
                    accuLogoSlotRef.current = slot.key;
                    accuLogoInputRef.current?.click();
                  }}
                  className={`w-full h-[105px] rounded-xl flex items-center px-2 transition-colors ${
                    img
                      ? `${slot.align} border border-nhra-border/60 bg-white/[0.03] hover:border-gray-600`
                      : "justify-center border-2 border-dashed border-nhra-border hover:border-gray-600"
                  }`}
                  title={img ? "Click to replace this logo" : slot.label}
                >
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt={`${slot.key} logo`}
                      className="max-h-[97px] max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-gray-500">{slot.label}</span>
                  )}
                </button>
                {img && (
                  <button
                    onClick={() => updateLogo(slot.key, null)}
                    className="absolute top-1.5 right-1.5 hidden group-hover:flex items-center justify-center w-6 h-6 rounded-full bg-black/70 border border-nhra-border text-gray-300 hover:text-white text-xs"
                    title="Remove this logo"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <label className="text-xs text-gray-400 flex-1 min-w-[16rem]">
            Header / series line (PDF banner)
            <input
              value={accuSeries}
              onChange={(e) => {
                accuSeriesEdited.current = true;
                setAccuSeries(e.target.value);
              }}
              placeholder="prefills from Class.ini — e.g. NHRA Mission Foods Drag Racing Series"
              className="mt-1 w-full px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white placeholder-gray-600"
            />
          </label>
          <label className="text-xs text-gray-400 w-64">
            Class when Class.ini has none
            <select
              value={accuClassPick}
              onChange={(e) => setAccuClassPick(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white"
            >
              <option value="">— pick a class —</option>
              {ACCU_CLASS_OPTIONS.map((o) => (
                <option key={`${o.code}-${o.name}`} value={o.code}>
                  {o.name} ({o.code})
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs text-gray-400 flex flex-col gap-1.5 pb-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={accuCalcPoints}
                onChange={(e) => setAccuCalcPoints(e.target.checked)}
                className="accent-nhra-red cursor-pointer"
              />
              Calculate points
            </label>
            <label
              className="flex items-center gap-2 cursor-pointer"
              title="Sportsman/alcohol only: racers who won their last matchup get the next round's loss points as a guaranteed minimum. NHRA publishes no pro equivalent, so pro classes are unaffected."
            >
              <input
                type="checkbox"
                checked={accuIncomplete}
                onChange={(e) => setAccuIncomplete(e.target.checked)}
                className="accent-nhra-red cursor-pointer"
              />
              Incomplete race — guaranteed points (sportsman/alcohol)
            </label>
          </div>
          <label
            className="text-xs text-gray-400 w-56"
            title="Which Mission Foods value set the pro classes (TF/FC/PS/PSM…) score: Indy and the Pomona 2 Countdown finale pay W150/RU120 with the stepped-up qualifying values; every other event — Countdown included — pays the regular W100/RU80 scale. Sportsman and alcohol points ignore this."
          >
            Pro event scale
            <select
              value={accuProScale}
              onChange={(e) => setAccuProScale(e.target.value as ProEventScale)}
              className="mt-1 w-full px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white"
            >
              {PRO_EVENT_SCALES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="text-xs text-gray-400 w-24"
            title="Race code in the points filename: 16 → C10A16DP.TXT"
          >
            Race #
            <input
              value={accuRaceCode}
              onChange={(e) => setAccuRaceCode(e.target.value)}
              placeholder="16"
              className="mt-1 w-full px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white placeholder-gray-600"
            />
          </label>
          {accuSessions.length > 0 && !accuUploading && (
            <button
              onClick={() => void postAccuBuild([])}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-nhra-darker border border-nhra-border text-gray-200 hover:text-white hover:border-gray-500"
            >
              Rebuild package
            </button>
          )}
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
            void collectAccuDrop(e.dataTransfer).then(handleAccuUpload);
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
            accept=".dat,.qly,.ini,.dbf,.zip,.txt,.DAT,.QLY,.INI,.DBF,.ZIP,.TXT"
            className="hidden"
            onChange={(e) =>
              handleAccuUpload(
                Array.from(e.target.files || []).map((f) => ({
                  file: f,
                  path: f.webkitRelativePath || f.name,
                })),
              )
            }
          />
          <p className="text-white font-medium mb-1">
            {accuUploading ? "Working…" : "Drop AccuTime session files here"}
          </p>
          <p className="text-xs text-gray-500">
            race.dat + race.qly + Class.ini + Drivers.dbf, or Compulink C#QDAT/C#EDAT .TXT —
            folders and zips welcome; no .acc needed, it&apos;s locked
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

        {accuMerge && (accuMerge.added.length > 0 || accuMerge.replaced.length > 0) && (
          <div className="mt-3 bg-green-500/10 border border-green-500/40 text-green-400 rounded-xl px-4 py-3 text-xs">
            {[
              accuMerge.added.length > 0 ? `Added to the pack: ${accuMerge.added.join(", ")}` : "",
              accuMerge.replaced.length > 0 ? `Replaced with this drop: ${accuMerge.replaced.join(", ")}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
            {accuSessions.length > accuMerge.added.length + accuMerge.replaced.length
              ? " — every other class already in the pack is untouched."
              : ""}
          </div>
        )}

        {accuResult && accuResult.sessions.some((s) => !s.classCode) && (
          <div className="mt-3 bg-yellow-500/5 border border-yellow-500/30 text-yellow-500 rounded-xl px-4 py-3 text-xs">
            {accuResult.sessions.filter((s) => !s.classCode).length === accuResult.sessions.length
              ? "No class code was found in the session files"
              : "A session came through without a class code"}{" "}
            — Class.ini normally carries it. Pick the class above and hit Rebuild package;
            until then those files export with the class marked UNKNOWN.
          </div>
        )}

        {accuResult && accuResult.sessions.length > 0 && (
          <div className="mt-4 border border-nhra-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-nhra-darker border-b border-nhra-border flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm text-white font-semibold">
                  {accuResult.sessions.length} class
                  {accuResult.sessions.length === 1 ? "" : "es"} in the pack ·{" "}
                  {accuResult.edat.length} EDAT · {accuResult.qdat.length} QDAT ·{" "}
                  {[accuResult.finalsPdfBase64 && "finals PDF", accuResult.qualifyingPdfBase64 && "qualifying PDF"]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Saved in this browser — classes accumulate across drops and survive a refresh.
                  Re-dropping a class replaces just that class.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleAccuClearData}
                  className="px-4 py-2 rounded-lg text-sm font-semibold border border-red-500/40 text-red-400 hover:bg-red-500/10 hover:border-red-500/70"
                  title="Wipes every class saved in this browser and the built package — for starting a new event. Header logos stay."
                >
                  Clear data
                </button>
                <button
                  onClick={handleDownloadAccuZip}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-nhra-red text-white hover:bg-red-600"
                  title="Compulink text only: C#QDAT / C#EDAT / C#A16DP + IDX14.TXT — PDFs download separately below"
                >
                  Download RACEDATA.zip
                </button>
              </div>
            </div>
            <div className="divide-y divide-nhra-border/60">
              {accuResult.sessions.map((s, i) => {
                const cov = accuResult.coverage.find((c) => c.category === s.className);
                const hasQdat = accuResult.qdat.some((f) => f.category === s.className);
                const hasEdat = accuResult.edat.some((f) => f.category === s.className);
                return (
                  <div key={`${s.className}-${i}`} className="px-4 py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-medium">
                          {s.className} <span className="text-gray-500">({s.classCode || "?"})</span>
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                            hasQdat ? "border-green-500/40 text-green-400" : "border-nhra-border text-gray-600"
                          }`}
                          title={hasQdat ? "Qualifying file in the pack" : "No qualifying data for this class"}
                        >
                          QDAT
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                            hasEdat ? "border-green-500/40 text-green-400" : "border-nhra-border text-gray-600"
                          }`}
                          title={hasEdat ? "Eliminations file in the pack" : "No elimination rounds for this class"}
                        >
                          EDAT
                        </span>
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

        {/* ——— Points, with deductions ——— */}
        {accuResult && (accuResult.points.length > 0 || accuResult.pointsSkipped.length > 0) && (
          <div className="mt-4 border border-nhra-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-nhra-darker border-b border-nhra-border">
              <p className="text-sm text-white font-semibold">Points</p>
              <p className="text-xs text-gray-500 mt-0.5">
                NHRA sportsman brackets by field size; TAD/TAFC score the fixed alcohol bracket
                plus qualifying position and attempt points; pro classes (TF/FC/PS/PSM…) score
                the national-event structure — rounds, qualifying position, participation and
                session low-ET bonuses — on the picked event scale. Points files ({accuResult.points
                  .map((p) => p.filename)
                  .join(", ") || "—"}) go into the RACEDATA.zip with deductions applied.
              </p>
              {accuResult.pointsSkipped.length > 0 && (
                <p className="text-xs text-yellow-500 mt-1">
                  Skipped:{" "}
                  {accuResult.pointsSkipped
                    .map((s) => `${s.category} (no elimination rounds)`)
                    .join(" · ")}
                </p>
              )}
            </div>

            {accuResult.points.map((cat) => {
              const rows = pointsRowsFinal(cat);
              const anyDed = rows.some((r) => r.deducted > 0);
              return (
                <div key={cat.filename} className="border-b border-nhra-border/60">
                  <div className="px-4 py-2 bg-nhra-darker/40 flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-xs text-white font-semibold">
                      {cat.category}{" "}
                      <span className="text-gray-500 font-normal">
                        ({cat.classCode}) · field of {cat.fieldSize}
                        {cat.alcohol ? " · alcohol bracket + qual/attempt points" : ""}
                        {cat.pro && cat.proScale ? ` · pro — ${proScaleLabel(cat.proScale)}` : ""}
                      </span>
                    </p>
                    <button
                      onClick={() => {
                        const withDed = rows.map((r) => ({ ...r, deduction: r.deducted }));
                        downloadBytes(
                          cat.filename,
                          edataBytes(buildPointsFileContent(cat.category, withDed)),
                          "text/plain",
                        );
                      }}
                      className="text-xs px-2.5 py-1 rounded border border-nhra-border text-gray-300 hover:text-white hover:border-gray-500 font-mono"
                    >
                      {cat.filename}
                    </button>
                  </div>
                  {(cat.notes || []).length > 0 && (
                    <ul className="px-4 py-1.5 space-y-0.5 bg-nhra-darker/20">
                      {(cat.notes || []).map((n, ni) => (
                        <li key={ni} className="text-[11px] text-yellow-500/90">
                          {n}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-gray-500 uppercase tracking-wider">
                        <tr>
                          <th className="text-left px-4 py-1.5 font-medium">Car</th>
                          <th className="text-left px-2 py-1.5 font-medium">Driver</th>
                          <th className="text-left px-2 py-1.5 font-medium">Status</th>
                          <th className="text-right px-2 py-1.5 font-medium">Points</th>
                          <th className="text-right px-2 py-1.5 font-medium">Deducted</th>
                          <th className="text-right px-4 py-1.5 font-medium">Final</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, ri) => (
                          <tr key={`${r.car_number}-${ri}`} className="border-t border-nhra-border/40">
                            <td className="px-4 py-1.5 text-gray-300 font-mono">{r.car_number || "—"}</td>
                            <td className="px-2 py-1.5 text-white">
                              {r.name || "—"}
                              {r.isWinner ? " 🏆" : ""}
                            </td>
                            <td className="px-2 py-1.5 text-gray-400">{r.status}</td>
                            <td className="px-2 py-1.5 text-right text-gray-300 tabular-nums">{r.points}</td>
                            <td
                              className={`px-2 py-1.5 text-right tabular-nums ${
                                r.deducted > 0 ? "text-red-400" : "text-gray-600"
                              }`}
                            >
                              {r.deducted > 0 ? `−${r.deducted}` : "—"}
                            </td>
                            <td
                              className={`px-4 py-1.5 text-right font-semibold tabular-nums ${
                                anyDed && r.deducted > 0 ? "text-yellow-500" : "text-white"
                              }`}
                            >
                              {r.final}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            {/* Deductions — oil-downs and other penalties, applied before export. */}
            {accuResult.points.length > 0 && (
              <div className="px-4 py-3 bg-nhra-darker/40">
                <p className="text-xs text-white font-semibold mb-2">
                  Deductions{" "}
                  <span className="text-gray-500 font-normal">
                    — oil-downs and penalties; adjusts the points files and is listed in
                    DEDUCTIONS.TXT in the zip
                  </span>
                </p>
                <div className="flex flex-wrap items-end gap-2 mb-2">
                  <label className="text-[11px] text-gray-500">
                    Class
                    <select
                      value={dedCat}
                      onChange={(e) => {
                        setDedCat(e.target.value);
                        setDedCar("");
                      }}
                      className="block mt-0.5 px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded text-xs text-white min-w-[10rem]"
                    >
                      <option value="">— class —</option>
                      {accuResult.points.map((p) => (
                        <option key={p.filename} value={p.category}>
                          {p.category}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] text-gray-500">
                    Racer
                    <select
                      value={dedCar}
                      onChange={(e) => setDedCar(e.target.value)}
                      className="block mt-0.5 px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded text-xs text-white min-w-[12rem]"
                    >
                      <option value="">— racer —</option>
                      {(accuResult.points.find((p) => p.category === dedCat)?.rows || []).map(
                        (r, ri) => (
                          <option key={`${r.car_number}-${ri}`} value={r.car_number}>
                            {r.car_number} {r.name}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label className="text-[11px] text-gray-500">
                    Reason
                    <select
                      value={dedReason}
                      onChange={(e) => setDedReason(e.target.value)}
                      className="block mt-0.5 px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded text-xs text-white"
                    >
                      {DEDUCTION_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] text-gray-500">
                    Note
                    <input
                      value={dedNote}
                      onChange={(e) => setDedNote(e.target.value)}
                      placeholder={dedReason === "Other" ? "what happened" : "optional"}
                      className="block mt-0.5 px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded text-xs text-white placeholder-gray-600 w-40"
                    />
                  </label>
                  <label className="text-[11px] text-gray-500">
                    Points
                    <input
                      value={dedPoints}
                      onChange={(e) => setDedPoints(e.target.value)}
                      inputMode="numeric"
                      placeholder="10"
                      className="block mt-0.5 px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded text-xs text-white placeholder-gray-600 w-16"
                    />
                  </label>
                  <button
                    onClick={addDeduction}
                    disabled={
                      !dedCat || !dedCar || !(parseFloat(dedPoints) > 0) || (dedReason === "Other" && !dedNote.trim())
                    }
                    className="px-3 py-1.5 rounded text-xs font-semibold bg-nhra-red text-white hover:bg-red-600 disabled:opacity-40"
                  >
                    Add deduction
                  </button>
                </div>
                {accuDeductions.length > 0 && (
                  <ul className="space-y-1">
                    {accuDeductions.map((d) => (
                      <li key={d.id} className="flex items-center gap-2 text-xs text-gray-300">
                        <button
                          onClick={() =>
                            setAccuDeductions((prev) => prev.filter((x) => x.id !== d.id))
                          }
                          className="w-5 h-5 rounded border border-nhra-border text-gray-500 hover:text-white hover:border-gray-500 leading-none"
                          title="Remove this deduction"
                        >
                          ✕
                        </button>
                        <span className="text-red-400 font-semibold tabular-nums">−{d.points}</span>
                        <span className="text-white">
                          {d.car_number} {d.name}
                        </span>
                        <span className="text-gray-500">
                          {d.category} · {d.reason}
                          {d.note ? ` — ${d.note}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {appliedDeductions().length > 0 && (
                  <button
                    onClick={() =>
                      downloadBytes(
                        "DEDUCTIONS.TXT",
                        edataBytes(buildDeductionsSheet(appliedDeductions())),
                        "text/plain",
                      )
                    }
                    className="mt-2 text-xs px-2.5 py-1 rounded border border-nhra-border text-gray-300 hover:text-white hover:border-gray-500 font-mono"
                    title="Audit sheet with reasons and notes — downloads separately, not part of RACEDATA.zip"
                  >
                    DEDUCTIONS.TXT
                  </button>
                )}
              </div>
            )}
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
