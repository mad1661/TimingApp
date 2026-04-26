"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLiveData } from "@/components/LiveDataProvider";
import LadderSheet, { LadderSheetHeader } from "@/components/LadderSheet";
import { buildLadder, Qualifier, SUPPORTED_FIELD_SIZES, advancerKey, seedResultKey, type AdvancerMap, type SeedResultMap } from "@/lib/ladder";

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
  { size: 16, label: "16-Car Quad Ladder", supported: true },
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
  // Per-quad winner / runner-up picks. Key is "round-quadIndex" (e.g. "1-3"),
  // value is [winnerSeedPosition, runnerUpSeedPosition].
  const [advancers, setAdvancers] = useState<AdvancerMap>({});
  // Per-seed-per-round ET / MPH captured from auto-fill so R2+ lanes can
  // show what the racer actually ran in the previous round (instead of the
  // original qualifying ET / MPH). Key is "{round}-{seed}".
  const [seedResults, setSeedResults] = useState<SeedResultMap>({});
  // Suppresses the auto-save side effect during rehydrate so we don't
  // immediately overwrite the doc we just loaded with our empty initial
  // state on the very first render after a category switch.
  const [stateLoaded, setStateLoaded] = useState(false);

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

  // Load saved ladder state (qualifiers + advancers) whenever the
  // (event, season, class) changes. Resets the in-memory state first so a
  // category switch doesn't bleed the previous class's qualifiers through.
  useEffect(() => {
    setStateLoaded(false);
    setQualifiers([]);
    setAdvancers({});
    setSeedResults({});
    if (!canPersistHeader) return;
    let cancelled = false;
    fetch(
      `/api/stats?type=ladder-state&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}&category=${encodeURIComponent(headerCategoryKey)}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const s = data.state;
        if (s && Array.isArray(s.qualifiers) && s.qualifiers.length > 0) {
          setQualifiers(s.qualifiers as Qualifier[]);
          setAdvancers(s.advancers && typeof s.advancers === "object" ? s.advancers : {});
          setSeedResults(s.seedResults && typeof s.seedResults === "object" ? s.seedResults : {});
          if (inputMode === "manual" && typeof s.classCode === "string" && s.classCode) {
            setClassCode(s.classCode);
          }
          if (typeof s.fieldSize === "number" && SUPPORTED_FIELD_SIZES.includes(s.fieldSize)) {
            setFieldSize(s.fieldSize);
          }
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setStateLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // intentionally not depending on inputMode / classCode / fieldSize — we
    // only want to reload when the (event, season, class) trio changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventCode, season, headerCategoryKey, canPersistHeader]);

  // Debounced save of qualifiers + advancers.
  useEffect(() => {
    if (!canPersistHeader || !stateLoaded) return;
    const t = setTimeout(() => {
      fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "save-ladder-state",
          event_code: eventCode,
          season,
          category: headerCategoryKey,
          state: {
            fieldSize,
            qualifiers,
            advancers,
            seedResults,
            classCode: inputMode === "manual" ? classCode : undefined,
          },
        }),
      }).catch(console.error);
    }, 800);
    return () => clearTimeout(t);
  }, [
    eventCode,
    season,
    headerCategoryKey,
    canPersistHeader,
    stateLoaded,
    qualifiers,
    advancers,
    seedResults,
    fieldSize,
    inputMode,
    classCode,
  ]);

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
      // Truncate to the configured field size — anyone outside the top-N
      // didn't make the field. (Lower position number = higher seed.)
      const trimmed = [...results]
        .sort((a, b) => a.position - b.position)
        .slice(0, fieldSize);
      const droppedCount = results.length - trimmed.length;
      if (trimmed.length < fieldSize) {
        setEventError(
          `Only ${trimmed.length} qualifiers found but ladder is sized for ${fieldSize}. Switch field size or pick a different class.`,
        );
      } else if (droppedCount > 0) {
        setEventError(
          `Loaded top ${fieldSize} of ${results.length} qualifiers. ${droppedCount} bumped from the field.`,
        );
      }
      const cat = trimmed[0].category || "";
      setClassCodeFromApi(cat);
      const qs: Qualifier[] = trimmed.map((r) => ({
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
      ladder = buildLadder(qualifiers, advancers, seedResults);
    } catch (err) {
      buildError = err instanceof Error ? err.message : "Failed to build ladder";
    }
  }

  const qualifierByPosition = useMemo(() => {
    const m = new Map<number, Qualifier>();
    for (const q of qualifiers) m.set(q.position, q);
    return m;
  }, [qualifiers]);

  // Resolve Champion + Runner-Up lanes for the printed sheet from the user's
  // pick of the final quad's W / RU. Auto-fill from the F (final) round can
  // populate this; otherwise the user picks manually below.
  function laneFromSeed(seed: number, sourceRound: number): {
    position: number;
    qualifier: Qualifier | null;
    runEt: number | null;
    runMph: number | null;
  } | null {
    if (!seed) return null;
    const q = qualifierByPosition.get(seed) || null;
    const sr = seedResults[seedResultKey(sourceRound, seed)] || null;
    return {
      position: seed,
      qualifier: q,
      runEt: sr?.et ?? null,
      runMph: sr?.mph ?? null,
    };
  }
  const finalRoundNum = ladder ? ladder.rounds.length : 0;
  const finalPicks = finalRoundNum > 0 ? advancers[advancerKey(finalRoundNum, 1)] || null : null;
  const championLane = finalPicks ? laneFromSeed(finalPicks[0], finalRoundNum) : null;
  const runnerUpLane = finalPicks ? laneFromSeed(finalPicks[1], finalRoundNum) : null;

  function setQuadAdvancers(round: number, quadIndex: number, picks: [number, number] | null) {
    setAdvancers((prev) => {
      const next = { ...prev };
      const k = advancerKey(round, quadIndex);
      if (picks == null) delete next[k];
      else next[k] = picks;
      return next;
    });
  }

  // Pull each ladder quad's winner / runner-up from the live event data for
  // a given elimination round. Matches by car number against each pair / quad
  // in the timing sheet for that round.
  const [autoFillStatus, setAutoFillStatus] = useState<string | null>(null);
  const autoFillCategory = inputMode === "event" ? selectedCategory : "";
  const autoFillFromEvent = useCallback(
    async (ladderRound: number, eventRound: string) => {
      if (!ladder) return;
      if (!eventCode || !season || !autoFillCategory) {
        setAutoFillStatus("Auto-fill needs an event-loaded ladder (event mode).");
        return;
      }
      const targetRound = ladder.rounds[ladderRound - 1];
      if (!targetRound) return;
      setAutoFillStatus(`Loading ${eventRound}…`);
      try {
        const res = await fetch(
          `/api/stats?type=ladder-results&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}&category=${encodeURIComponent(autoFillCategory)}&round=${encodeURIComponent(eventRound)}`,
        );
        const data = await res.json();
        const pairs: Array<{
          cars: string[];
          finishOrder: Array<{
            car: string;
            et: number | null;
            mph: number | null;
            result: string | null;
          }>;
        }> = data.results || [];
        if (pairs.length === 0) {
          setAutoFillStatus(`No ${eventRound} runs found for ${autoFillCategory}. Refresh the data and try again.`);
          return;
        }

        // Index every car's run info once (ET / MPH / W-R-3-4 result). NHRA
        // marks the W / R / 3 / 4 column on each row, so we can rank the
        // ladder quad's seeds purely by that column without depending on
        // how the underlying scrape happened to split the 4-wide race into
        // pairs of rows.
        const carInfo = new Map<
          string,
          { et: number | null; mph: number | null; result: string | null }
        >();
        for (const p of pairs) {
          for (const entry of p.finishOrder) {
            if (!carInfo.has(entry.car)) {
              carInfo.set(entry.car, {
                et: entry.et,
                mph: entry.mph,
                result: entry.result,
              });
            }
          }
        }
        const resultPos = (res: string | null): number => {
          const r = (res || "").trim().toUpperCase();
          if (r === "W") return 1;
          if (r === "R") return 2;
          if (r === "3") return 3;
          if (r === "4") return 4;
          return 99;
        };

        let filled = 0;
        const updated: AdvancerMap = { ...advancers };
        const updatedResults: SeedResultMap = { ...seedResults };
        for (const quad of targetRound) {
          const eligibleSeeds = quad.lanes
            .filter((l) => !l.isBye && l.position != null && l.qualifier?.carNumber)
            .map((l) => ({
              seed: l.position as number,
              car: (l.qualifier!.carNumber as string).trim(),
            }));
          if (eligibleSeeds.length < 2) continue;

          // Look up each seed's individual run info. A seed without a hit
          // didn't race in this round at all (DNS / no-show); rank it last.
          const ranked = eligibleSeeds
            .map((es) => {
              const info = carInfo.get(es.car);
              return {
                seed: es.seed,
                car: es.car,
                et: info?.et ?? null,
                mph: info?.mph ?? null,
                result: info?.result ?? null,
                rank: info ? resultPos(info.result) : 100,
              };
            })
            .sort((a, b) => {
              if (a.rank !== b.rank) return a.rank - b.rank;
              // Both have the same W / R / 3 / 4 (typically: both null on
              // bye runs, or both DNS) — fall back to seed order so the
              // higher seed advances first.
              return a.seed - b.seed;
            });

          if (ranked.length < 2) continue;
          // Don't write advancers if we have zero data on these cars at all
          // — that means E-round results haven't been scraped yet for any
          // of them, leave any previous good values alone.
          if (ranked.every((r) => r.rank === 100)) continue;

          updated[advancerKey(ladderRound, quad.quadIndex)] = [
            ranked[0].seed,
            ranked[1].seed,
          ];
          // Capture each advancer's actual round ET / MPH so the next
          // round's lanes print what they ran here.
          for (const r of ranked.slice(0, 2)) {
            updatedResults[seedResultKey(ladderRound, r.seed)] = {
              et: r.et,
              mph: r.mph,
            };
          }
          filled++;
        }
        setAdvancers(updated);
        setSeedResults(updatedResults);
        setAutoFillStatus(
          filled === 0
            ? `${eventRound} loaded but no quads matched the ladder cars.`
            : `Filled ${filled} quad${filled === 1 ? "" : "s"} from ${eventRound}.`,
        );
      } catch (err) {
        console.error(err);
        setAutoFillStatus("Failed to load round results.");
      }
    },
    [ladder, eventCode, season, autoFillCategory, advancers],
  );

  // Default elim-round name suggestion per ladder transition: R1→R2 = E1, etc.
  // R4 = the final round (W of that quad becomes Champion).
  const [autoFillRound, setAutoFillRound] = useState<Record<number, string>>({
    1: "E1",
    2: "E2",
    3: "E3",
    4: "F",
  });
  function setAutoFillRoundFor(r: number, value: string) {
    setAutoFillRound((prev) => ({ ...prev, [r]: value }));
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
            <LadderSheet
              ladder={ladder}
              header={header}
              champion={championLane}
              runnerUp={runnerUpLane}
            />
          </div>

          <div className="no-print mt-6 bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-white mb-1">
              Advance Winners
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              Pick the winner and runner-up of each quad. They&apos;ll fill the
              corresponding lanes in the next round automatically. Saved per
              event + class — close the page and come back, it&apos;s still here.
            </p>
            {autoFillStatus && (
              <p className="text-xs text-nhra-accent mb-3">{autoFillStatus}</p>
            )}
            <div className="space-y-5">
              {ladder.rounds.map((round, ri) => {
                const roundNum = ri + 1;
                const totalRounds = ladder.rounds.length;
                const roundLabel = (() => {
                  if (roundNum === totalRounds) return "Final → Champion";
                  if (roundNum === totalRounds - 1) return "Semifinals → Final";
                  if (roundNum === totalRounds - 2) return `Round ${roundNum} → Semifinals`;
                  return `Round ${roundNum} → Round ${roundNum + 1}`;
                })();
                const elimRoundOptions = availableRounds.filter((r) => r.startsWith("E") || r === "F" || r === "SF");
                return (
                  <div key={roundNum}>
                    <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
                      <h3 className="text-xs uppercase tracking-wider text-gray-500">
                        {roundLabel}
                      </h3>
                      {inputMode === "event" && eventCode && (() => {
                        const defaultRound = roundNum === totalRounds ? "F" : `E${roundNum}`;
                        const value = autoFillRound[roundNum] || defaultRound;
                        return (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase text-gray-500">Auto-fill from</span>
                            <select
                              value={value}
                              onChange={(e) => setAutoFillRoundFor(roundNum, e.target.value)}
                              className="px-2 py-1 bg-nhra-darker border border-nhra-border rounded text-white text-xs focus:outline-none focus:border-nhra-accent"
                            >
                              {elimRoundOptions.length === 0 && (
                                <option value={value}>{value}</option>
                              )}
                              {elimRoundOptions.map((r) => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => autoFillFromEvent(roundNum, value)}
                              className="px-3 py-1 bg-nhra-red text-white rounded text-xs font-medium hover:bg-red-700"
                            >
                              Auto-fill
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {round.map((quad) => (
                        <QuadAdvancePicker
                          key={`${roundNum}-${quad.quadIndex}`}
                          round={roundNum}
                          quadIndex={quad.quadIndex}
                          eligible={quad.lanes
                            .filter((l) => !l.isBye && l.position != null)
                            .map((l) => l.position as number)}
                          byPosition={qualifierByPosition}
                          picks={advancers[advancerKey(roundNum, quad.quadIndex)] || null}
                          onChange={(picks) => setQuadAdvancers(roundNum, quad.quadIndex, picks)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-end">
              <button
                onClick={() => {
                  setAdvancers({});
                  setSeedResults({});
                }}
                disabled={Object.keys(advancers).length === 0 && Object.keys(seedResults).length === 0}
                className="px-3 py-1.5 bg-nhra-darker border border-nhra-border text-gray-400 rounded-md text-xs hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Clear all advancers
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function QuadAdvancePicker({
  round,
  quadIndex,
  eligible,
  byPosition,
  picks,
  onChange,
}: {
  round: number;
  quadIndex: number;
  eligible: number[];
  byPosition: Map<number, Qualifier>;
  picks: [number, number] | null;
  onChange: (picks: [number, number] | null) => void;
}) {
  const [first, second] = picks || [0, 0];
  const labelFor = (pos: number) => {
    const q = byPosition.get(pos);
    if (!q) return `Seed ${pos}`;
    const car = q.carNumber ? `#${q.carNumber} ` : "";
    const driver = q.driver || "";
    return `${pos}. ${car}${driver}`.trim();
  };

  function update(slot: 0 | 1, value: number) {
    let nextFirst = slot === 0 ? value : first;
    let nextSecond = slot === 1 ? value : second;
    // Don't let the same seed sit in both slots — bump the other to 0.
    if (slot === 0 && nextFirst && nextFirst === nextSecond) nextSecond = 0;
    if (slot === 1 && nextSecond && nextSecond === nextFirst) nextFirst = 0;
    // Persist partial picks too — only clear the entry when both are 0.
    if (!nextFirst && !nextSecond) {
      onChange(null);
    } else {
      onChange([nextFirst, nextSecond]);
    }
  }

  return (
    <div className="bg-nhra-darker border border-nhra-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-300">
          R{round} Quad {quadIndex}
        </span>
        {picks && (
          <button
            onClick={() => onChange(null)}
            className="text-[10px] text-gray-500 hover:text-red-400"
          >
            Clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">
            1st (Winner)
          </label>
          <select
            value={first || 0}
            onChange={(e) => update(0, parseInt(e.target.value, 10))}
            className="w-full px-2 py-1.5 bg-nhra-card border border-nhra-border rounded text-white text-xs focus:outline-none focus:border-nhra-accent"
          >
            <option value={0}>—</option>
            {eligible.map((p) => (
              <option key={p} value={p}>
                {labelFor(p)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">
            2nd (Runner-up)
          </label>
          <select
            value={second || 0}
            onChange={(e) => update(1, parseInt(e.target.value, 10))}
            className="w-full px-2 py-1.5 bg-nhra-card border border-nhra-border rounded text-white text-xs focus:outline-none focus:border-nhra-accent"
          >
            <option value={0}>—</option>
            {eligible.map((p) => (
              <option key={p} value={p}>
                {labelFor(p)}
              </option>
            ))}
          </select>
        </div>
      </div>
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
