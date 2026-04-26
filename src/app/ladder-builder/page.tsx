"use client";

import { useState, useEffect, useCallback } from "react";
import { useLiveData } from "@/components/LiveDataProvider";
import LadderSheet, { LadderSheetHeader } from "@/components/LadderSheet";
import { buildLadder, Qualifier, SUPPORTED_FIELD_SIZES } from "@/lib/ladder";

interface QualifyingEntry {
  position: number;
  name: string;
  car_number: string;
  category: string;
  et: number;
  mph: number | null;
  rt: number | null;
  dial_in: number | null;
  diff: number | null;
  round: string;
  timestamp: string;
}

interface ManualRow {
  position: number;
  carNumber: string;
  driver: string;
  hometown: string;
  car: string;
  motor: string;
  et: string;
  qMph: string;
  topMph: string;
}

const FIELD_SIZE_OPTIONS = [
  { size: 17, label: "17-Car Quad Ladder", supported: true },
  { size: 16, label: "16-Car Quad Ladder", supported: false },
  { size: 15, label: "15-Car Quad Ladder", supported: false },
  { size: 14, label: "14-Car Quad Ladder", supported: false },
];

function emptyManualRows(size: number): ManualRow[] {
  return Array.from({ length: size }, (_, i) => ({
    position: i + 1,
    carNumber: "",
    driver: "",
    hometown: "",
    car: "",
    motor: "",
    et: "",
    qMph: "",
    topMph: "",
  }));
}

export default function LadderBuilderPage() {
  const live = useLiveData();
  const eventCode = live.config?.eventCode || "";
  const season = live.config?.season || "";

  const [fieldSize, setFieldSize] = useState(17);
  const [inputMode, setInputMode] = useState<"event" | "manual">("manual");

  // Event-load state
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [availableRounds, setAvailableRounds] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedRounds, setSelectedRounds] = useState<Set<string>>(new Set());
  const [classCodeFromApi, setClassCodeFromApi] = useState("");
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);

  // Manual state
  const [manualRows, setManualRows] = useState<ManualRow[]>(() =>
    emptyManualRows(17)
  );
  const [classCode, setClassCode] = useState("FSS");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  // Header state
  const [header, setHeader] = useState<LadderSheetHeader>({
    eventTitle: "",
    venue: "",
    dateRange: "",
    classTitle: "",
    seriesBanner: "",
    runDate: "",
    runTime: "",
    systemMark: "",
  });

  // Built data
  const [qualifiers, setQualifiers] = useState<Qualifier[]>([]);

  // Load event filters
  useEffect(() => {
    if (!eventCode || !season) return;
    fetch(
      `/api/runs?event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}&limit=1`
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.filters) {
          setAvailableCategories(data.filters.categories || []);
          setAvailableRounds(data.filters.rounds || []);
        }
      })
      .catch(console.error);
  }, [eventCode, season]);

  // Storage key for the header: event + season + category. The "category"
  // is the qualifying class — selectedCategory in event mode, classCode in
  // manual mode. When this triple changes we load the saved header (if any);
  // when the header is edited, we debounce-save it back to Firestore.
  const headerCategoryKey =
    inputMode === "event" ? selectedCategory : classCode;
  const canPersistHeader = !!eventCode && !!season && !!headerCategoryKey;

  // Load saved header when (event, season, category) changes.
  useEffect(() => {
    if (!canPersistHeader) return;
    let cancelled = false;
    fetch(
      `/api/stats?type=ladder-header&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}&category=${encodeURIComponent(headerCategoryKey)}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.header && Object.keys(data.header).length > 0) {
          setHeader(data.header);
        }
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [eventCode, season, headerCategoryKey, canPersistHeader]);

  // Debounced save of header on changes.
  useEffect(() => {
    if (!canPersistHeader) return;
    const t = setTimeout(() => {
      fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "save-ladder-header",
          event_code: eventCode,
          season,
          category: headerCategoryKey,
          header,
        }),
      }).catch(console.error);
    }, 800);
    return () => clearTimeout(t);
  }, [eventCode, season, headerCategoryKey, header, canPersistHeader]);

  // Resize manual rows when fieldSize changes
  useEffect(() => {
    setManualRows((prev) => {
      if (prev.length === fieldSize) return prev;
      const next = emptyManualRows(fieldSize);
      for (let i = 0; i < Math.min(prev.length, fieldSize); i++) {
        next[i] = { ...prev[i], position: i + 1 };
      }
      return next;
    });
  }, [fieldSize]);

  const isSupported = SUPPORTED_FIELD_SIZES.includes(fieldSize);

  const loadFromEvent = useCallback(async () => {
    if (!eventCode || !season || !selectedCategory || selectedRounds.size === 0) {
      setEventError("Pick a class and at least one round");
      return;
    }
    setEventLoading(true);
    setEventError(null);
    try {
      const roundsParam = Array.from(selectedRounds).join(",");
      const res = await fetch(
        `/api/stats?type=qualifying&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}&category=${encodeURIComponent(selectedCategory)}&rounds=${encodeURIComponent(roundsParam)}&mode=quickest_et&tiebreaker=mph`
      );
      const data = await res.json();
      const results: QualifyingEntry[] = data.results || [];
      if (results.length === 0) {
        setEventError("No qualifying results found for that selection");
        setQualifiers([]);
        return;
      }
      if (results.length !== fieldSize) {
        setEventError(
          `Found ${results.length} qualifiers but ladder is sized for ${fieldSize}. Switch field size or pick a different class.`
        );
      }
      const cat = results[0].category || "";
      setClassCodeFromApi(cat);
      const qs: Qualifier[] = results.map((r) => ({
        position: r.position,
        carNumber: r.car_number,
        driver: r.name,
        classCode: cat,
        et: r.et,
        qMph: r.mph,
        topMph: r.mph,
      }));
      setQualifiers(qs);
      setHeader((h) => ({
        ...h,
        classTitle: cat ? cat.toUpperCase() : h.classTitle,
        eventTitle: live.config?.eventName || h.eventTitle,
      }));
    } catch (err) {
      console.error(err);
      setEventError("Failed to load qualifying data");
    } finally {
      setEventLoading(false);
    }
  }, [eventCode, season, selectedCategory, selectedRounds, fieldSize, live.config?.eventName]);

  const buildFromManual = useCallback(() => {
    const qs: Qualifier[] = manualRows
      .filter((r) => r.carNumber.trim() || r.driver.trim())
      .map((r) => ({
        position: r.position,
        carNumber: r.carNumber.trim() || null,
        driver: r.driver.trim() || null,
        classCode: classCode.trim() || null,
        hometown: r.hometown.trim() || null,
        car: r.car.trim() || null,
        motor: r.motor.trim() || null,
        et: r.et ? parseFloat(r.et) : null,
        qMph: r.qMph ? parseFloat(r.qMph) : null,
        topMph: r.topMph ? parseFloat(r.topMph) : null,
      }));
    setQualifiers(qs);
  }, [manualRows, classCode]);

  function applyPaste() {
    // Each line: position. car# class driver hometown car motor ET qMph topMph
    // Tolerant: split by 2+ spaces or tabs.
    const lines = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const next = emptyManualRows(fieldSize);
    for (const line of lines) {
      const cleaned = line.replace(/^\s*\d+\.\s*/, "");
      const parts = cleaned.split(/\t+|\s{2,}/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      // Identify by simple column heuristic. Expected:
      // [car# class driver hometown car motor et qmph topmph]
      const [carNumber, cls, driver, hometown = "", car = "", motor = "", et = "", qMph = "", topMph = ""] = parts;
      const pos = lines.indexOf(line) + 1;
      if (pos > fieldSize) break;
      next[pos - 1] = {
        position: pos,
        carNumber,
        driver: driver || "",
        hometown,
        car,
        motor,
        et,
        qMph,
        topMph,
      };
      // Class is shared; capture from first row.
      if (pos === 1 && cls) setClassCode(cls);
    }
    setManualRows(next);
    setPasteOpen(false);
  }

  function updateManualRow(idx: number, patch: Partial<ManualRow>) {
    setManualRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  let ladder = null;
  let buildError: string | null = null;
  if (qualifiers.length > 0 && isSupported) {
    try {
      ladder = buildLadder(qualifiers);
    } catch (err) {
      buildError = err instanceof Error ? err.message : "Failed to build ladder";
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="no-print mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Ladder Builder</h1>
        <p className="text-gray-400">
          Build a printable elimination ladder from qualifying results
        </p>
      </div>

      {/* Field size + input mode */}
      <div className="no-print bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Field Size</label>
            <select
              value={fieldSize}
              onChange={(e) => setFieldSize(parseInt(e.target.value, 10))}
              className="w-full px-4 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent"
              aria-label="Field Size"
            >
              {FIELD_SIZE_OPTIONS.map((o) => (
                <option key={o.size} value={o.size} disabled={!o.supported}>
                  {o.label}
                  {o.supported ? "" : " (coming soon)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Data Source</label>
            <div className="flex gap-2">
              <button
                onClick={() => setInputMode("event")}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  inputMode === "event"
                    ? "bg-nhra-red text-white"
                    : "bg-nhra-darker border border-nhra-border text-gray-300 hover:text-white"
                }`}
              >
                Load from event
              </button>
              <button
                onClick={() => setInputMode("manual")}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  inputMode === "manual"
                    ? "bg-nhra-red text-white"
                    : "bg-nhra-darker border border-nhra-border text-gray-300 hover:text-white"
                }`}
              >
                Manual / paste
              </button>
            </div>
          </div>
        </div>
        {!isSupported && (
          <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-sm rounded-lg">
            Field size {fieldSize} isn&apos;t implemented yet. Only the 17-car
            quad ladder works right now.
          </div>
        )}
      </div>

      {/* Header info */}
      <div className="no-print bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-3">Sheet Header</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <HeaderField
            label="Event Title"
            value={header.eventTitle || ""}
            onChange={(v) => setHeader({ ...header, eventTitle: v })}
            placeholder="NHRA and MISSION FOODS welcome you to the …"
          />
          <HeaderField
            label="Venue"
            value={header.venue || ""}
            onChange={(v) => setHeader({ ...header, venue: v })}
            placeholder="zMAX Dragway"
          />
          <HeaderField
            label="Date Range"
            value={header.dateRange || ""}
            onChange={(v) => setHeader({ ...header, dateRange: v })}
            placeholder="April 23-26, 2026"
          />
          <HeaderField
            label="Class Title"
            value={header.classTitle || ""}
            onChange={(v) => setHeader({ ...header, classTitle: v })}
            placeholder="FACTORY STOCK SHOWDOWN"
          />
          <HeaderField
            label="Series Banner"
            value={header.seriesBanner || ""}
            onChange={(v) => setHeader({ ...header, seriesBanner: v })}
            placeholder="FLEXJET NHRA FACTORY STOCK SHOWDOWN"
          />
          <HeaderField
            label="Run Date / Time"
            value={
              [header.runTime, header.runDate].filter(Boolean).join(" ") || ""
            }
            onChange={(v) => {
              const m = v.match(/^(.*?)\s+(\d{1,2}\/[A-Z]{3}\/\d{4})$/);
              if (m) setHeader({ ...header, runTime: m[1], runDate: m[2] });
              else setHeader({ ...header, runTime: v, runDate: "" });
            }}
            placeholder="6:05 PM 24/APR/2026"
          />
          <HeaderField
            label="Round #"
            value={header.roundNumber || ""}
            onChange={(v) => setHeader({ ...header, roundNumber: v })}
            placeholder="1"
          />
          <HeaderField
            label="System Mark"
            value={header.systemMark || ""}
            onChange={(v) => setHeader({ ...header, systemMark: v })}
            placeholder="CompuLink StarTrak"
          />
        </div>

        {/* Low E.T. and Top Speed callouts */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <CalloutGroup
            label="Low E.T."
            value={header.lowEt}
            onChange={(v) => setHeader({ ...header, lowEt: v })}
          />
          <CalloutGroup
            label="Top Speed"
            value={header.topSpeed}
            onChange={(v) => setHeader({ ...header, topSpeed: v })}
          />
        </div>
      </div>

      {/* Input panel */}
      {inputMode === "event" ? (
        <div className="no-print bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-white mb-3">Load from event</h2>
          {!eventCode && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-sm rounded-lg mb-3">
              No live event selected. Set one up in /setup or use Manual mode.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Class</label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-4 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent"
                aria-label="Class"
              >
                <option value="">Select class</option>
                {availableCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Rounds</label>
              <div className="flex flex-wrap gap-2">
                {availableRounds.map((r) => {
                  const active = selectedRounds.has(r);
                  return (
                    <button
                      key={r}
                      onClick={() => {
                        const next = new Set(selectedRounds);
                        if (active) next.delete(r);
                        else next.add(r);
                        setSelectedRounds(next);
                      }}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                        active
                          ? "bg-nhra-red text-white border-nhra-red"
                          : "bg-nhra-darker text-gray-300 border-nhra-border hover:text-white"
                      }`}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <button
            onClick={loadFromEvent}
            disabled={eventLoading || !selectedCategory || selectedRounds.size === 0}
            className="mt-4 px-5 py-2.5 bg-nhra-red text-white rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {eventLoading ? "Loading…" : "Load Qualifiers"}
          </button>
          {classCodeFromApi && qualifiers.length > 0 && (
            <p className="text-xs text-gray-400 mt-2">
              Loaded {qualifiers.length} qualifiers from {classCodeFromApi}
            </p>
          )}
          {eventError && (
            <p className="text-xs text-red-400 mt-2">{eventError}</p>
          )}
        </div>
      ) : (
        <div className="no-print bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Manual entry</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setPasteOpen(!pasteOpen)}
                className="px-3 py-1.5 bg-nhra-darker border border-nhra-border text-gray-300 rounded-md text-xs hover:text-white"
              >
                {pasteOpen ? "Close paste" : "Paste from sheet"}
              </button>
              <button
                onClick={() => setManualRows(emptyManualRows(fieldSize))}
                className="px-3 py-1.5 bg-nhra-darker border border-nhra-border text-gray-300 rounded-md text-xs hover:text-white"
              >
                Clear
              </button>
            </div>
          </div>

          {pasteOpen && (
            <div className="mb-4">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={8}
                placeholder={"1.  4  FSS  Jonathan Allegrucci  Scott Twp PA  '19 Mustang  FORD 327  7.716  178.68  179.11"}
                className="w-full px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm font-mono"
              />
              <button
                onClick={applyPaste}
                className="mt-2 px-4 py-2 bg-nhra-red text-white rounded-md text-xs font-medium"
              >
                Apply paste
              </button>
            </div>
          )}

          <div className="mb-3">
            <label className="block text-xs text-gray-400 mb-1">Class Code</label>
            <input
              type="text"
              value={classCode}
              onChange={(e) => setClassCode(e.target.value)}
              className="w-32 px-3 py-1.5 bg-nhra-darker border border-nhra-border rounded text-white text-sm"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-400 text-left">
                <tr>
                  <th className="px-2 py-1 w-8">#</th>
                  <th className="px-2 py-1">Car #</th>
                  <th className="px-2 py-1">Driver</th>
                  <th className="px-2 py-1">Hometown</th>
                  <th className="px-2 py-1">Car</th>
                  <th className="px-2 py-1">Motor</th>
                  <th className="px-2 py-1">ET</th>
                  <th className="px-2 py-1">Q-MPH</th>
                  <th className="px-2 py-1">Top MPH</th>
                </tr>
              </thead>
              <tbody>
                {manualRows.map((row, idx) => (
                  <tr key={idx} className="border-t border-nhra-border">
                    <td className="px-2 py-1 text-gray-500">{row.position}</td>
                    <td className="px-2 py-1">
                      <ManualInput
                        value={row.carNumber}
                        onChange={(v) => updateManualRow(idx, { carNumber: v })}
                        width="w-20"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <ManualInput
                        value={row.driver}
                        onChange={(v) => updateManualRow(idx, { driver: v })}
                        width="w-44"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <ManualInput
                        value={row.hometown}
                        onChange={(v) => updateManualRow(idx, { hometown: v })}
                        width="w-32"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <ManualInput
                        value={row.car}
                        onChange={(v) => updateManualRow(idx, { car: v })}
                        width="w-28"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <ManualInput
                        value={row.motor}
                        onChange={(v) => updateManualRow(idx, { motor: v })}
                        width="w-20"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <ManualInput
                        value={row.et}
                        onChange={(v) => updateManualRow(idx, { et: v })}
                        width="w-16"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <ManualInput
                        value={row.qMph}
                        onChange={(v) => updateManualRow(idx, { qMph: v })}
                        width="w-16"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <ManualInput
                        value={row.topMph}
                        onChange={(v) => updateManualRow(idx, { topMph: v })}
                        width="w-16"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={buildFromManual}
            className="mt-4 px-5 py-2.5 bg-nhra-red text-white rounded-lg font-medium hover:bg-red-700"
          >
            Build Ladder
          </button>
        </div>
      )}

      {/* Output */}
      {buildError && (
        <div className="no-print p-3 bg-red-500/10 border border-red-500/20 text-red-300 text-sm rounded-lg mb-6">
          {buildError}
        </div>
      )}

      {ladder && (
        <>
          <div className="no-print mb-4 flex items-center justify-between gap-4">
            <p className="text-xs text-gray-400">
              Tip: in your browser&apos;s print dialog, uncheck &ldquo;Headers and
              footers&rdquo; to remove the URL and page number.
            </p>
            <button
              onClick={() => window.print()}
              className="px-5 py-2.5 bg-nhra-red text-white rounded-lg font-medium hover:bg-red-700"
            >
              Print Ladder
            </button>
          </div>
          <div className="bg-white rounded-lg overflow-hidden shadow-2xl">
            <LadderSheet ladder={ladder} header={header} />
          </div>
        </>
      )}
    </div>
  );
}

function HeaderField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm"
      />
    </div>
  );
}

function ManualInput({
  value,
  onChange,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  width: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${width} px-2 py-1 bg-nhra-darker border border-nhra-border rounded text-white`}
    />
  );
}

function CalloutGroup({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: { value: string; carNumber: string; driver: string };
  onChange: (v: { value: string; carNumber: string; driver: string }) => void;
}) {
  const v = value || { value: "", carNumber: "", driver: "" };
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={v.value}
          onChange={(e) => onChange({ ...v, value: e.target.value })}
          placeholder="value"
          className="w-20 px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded text-white text-sm"
        />
        <input
          type="text"
          value={v.carNumber}
          onChange={(e) => onChange({ ...v, carNumber: e.target.value })}
          placeholder="car #"
          className="w-16 px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded text-white text-sm"
        />
        <input
          type="text"
          value={v.driver}
          onChange={(e) => onChange({ ...v, driver: e.target.value })}
          placeholder="driver"
          className="flex-1 px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded text-white text-sm"
        />
      </div>
    </div>
  );
}
