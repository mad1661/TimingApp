"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLiveData } from "@/components/LiveDataProvider";

interface DoubleClassEntry {
  category: string;
  car_number: string;
  status: "in" | "out" | "won" | "qualifying";
  lastElimRound: string | null;
  lostRound: string | null;
  outReason: "lost" | "missed_elims" | null;
  laterRoundStarted: boolean;
  runCount: number;
}

interface DoubledRacer {
  name: string;
  member_number: string | null;
  status: "doubled" | "single" | "done";
  aliveCount: number;
  entries: DoubleClassEntry[];
}

// Display rounds the way the tower calls them: E2 → R2.
function displayRound(round: string | null): string {
  if (!round) return "—";
  if (round === "F") return "Final";
  return round.replace(/^E/, "R");
}

function entryStatusLabel(e: DoubleClassEntry): string {
  switch (e.status) {
    case "in":
      return e.lastElimRound
        ? `IN — won ${displayRound(e.lastElimRound)}`
        : "IN — elims";
    case "qualifying":
      return "IN — qualifying";
    case "won":
      return "WON EVENT";
    case "out":
      return e.outReason === "missed_elims"
        ? "OUT — missed elims"
        : `OUT — lost ${displayRound(e.lostRound)}`;
  }
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const escape = (v: string): string => {
    if (v == null) return "";
    if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = [
    header.map(escape).join(","),
    ...rows.map((r) => r.map(escape).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string));
}

// The classes a racer still has to run — what the staging crew tracks.
function aliveEntries(r: DoubledRacer): DoubleClassEntry[] {
  return r.entries.filter((e) => e.status === "in" || e.status === "qualifying");
}

// Short round label for a class a racer is still in.
function aliveRoundLabel(e: DoubleClassEntry): string {
  if (e.status === "qualifying") return "Qualifying";
  return e.lastElimRound ? `Thru ${displayRound(e.lastElimRound)}` : "Eliminations";
}

function ClassChip({ entry }: { entry: DoubleClassEntry }) {
  const styles =
    entry.status === "out"
      ? "bg-red-500/10 border-red-500/40 text-red-400"
      : entry.status === "won"
        ? "bg-nhra-accent/10 border-nhra-accent/40 text-nhra-accent"
        : "bg-green-500/10 border-green-500/40 text-green-400";
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${styles}`}>
      <div className="min-w-0">
        <p className="text-sm font-bold text-white truncate">{entry.category}</p>
        <p className="text-xs text-nhra-accent font-semibold">
          {entry.car_number ? `#${entry.car_number}` : "no car #"}
        </p>
      </div>
      <div className="text-right shrink-0">
        <span className="text-xs font-bold whitespace-nowrap">{entryStatusLabel(entry)}</span>
        {entry.status === "in" && entry.laterRoundStarted && (
          <p className="text-[10px] text-yellow-500 mt-0.5 whitespace-nowrap">
            next round underway
          </p>
        )}
      </div>
    </div>
  );
}

function RacerCard({ racer }: { racer: DoubledRacer }) {
  return (
    <div className="bg-nhra-card border border-nhra-border rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <Link
            href={`/racer/${encodeURIComponent(racer.name)}`}
            className="text-white font-bold hover:text-nhra-accent transition-colors truncate block"
          >
            {racer.name}
          </Link>
          {racer.member_number && (
            <p className="text-xs text-gray-500">Member #{racer.member_number}</p>
          )}
        </div>
        {racer.status === "doubled" ? (
          <span className="shrink-0 px-3 py-1 bg-yellow-500/15 text-yellow-400 text-xs font-bold rounded-full flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
            STILL IN {racer.aliveCount}
          </span>
        ) : racer.status === "single" ? (
          <span className="shrink-0 px-3 py-1 bg-green-500/15 text-green-400 text-xs font-bold rounded-full">
            IN 1 CLASS
          </span>
        ) : (
          <span className="shrink-0 px-3 py-1 bg-gray-500/15 text-gray-400 text-xs font-bold rounded-full">
            DONE
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {racer.entries.map((e) => (
          <ClassChip key={e.category} entry={e} />
        ))}
      </div>
    </div>
  );
}

export default function DoublesPage() {
  const live = useLiveData();
  const selectedEvent = live.config?.eventCode || "";
  const selectedSeason = live.config?.season || "";

  const [racers, setRacers] = useState<DoubledRacer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!selectedEvent || !selectedSeason) return;
    setLoading(true);
    setError(null);
    try {
      const qs = `type=doubles&event_code=${encodeURIComponent(selectedEvent)}&season=${encodeURIComponent(selectedSeason)}`;
      const res = await fetch(`/api/stats?${qs}`, { cache: "no-store" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRacers(data.doubles || []);
      setSearched(true);
    } catch (err) {
      console.error(err);
      setError("Failed to load doubled-up racers");
    } finally {
      setLoading(false);
    }
  }, [selectedEvent, selectedSeason]);

  // Load on arrival and refresh whenever the live poll pulls new runs.
  useEffect(() => {
    load();
  }, [load, live.dataVersion]);

  const stillDoubled = racers.filter((r) => r.status === "doubled");
  const downToOne = racers.filter((r) => r.status === "single");
  const done = racers.filter((r) => r.status === "done");

  function exportCsv() {
    downloadCsv(
      `doubles-${selectedEvent}-${selectedSeason}.csv`,
      ["Racer", "Member #", "Class", "Car #", "Status", "Last Round"],
      racers.flatMap((r) =>
        r.entries.map((e) => [
          r.name,
          r.member_number || "",
          e.category,
          e.car_number,
          entryStatusLabel(e),
          displayRound(e.lastElimRound),
        ]),
      ),
    );
  }

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(""), 2500);
  }

  // Plain-text list of the currently doubled-up racers, for pasting into a
  // text/notes app for the staging crew.
  function buildCopyText(): string {
    const when = new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const title = live.config?.eventName || selectedEvent;
    const lines: string[] = [
      `DOUBLED UP — ${title}`,
      `As of ${when} · ${stillDoubled.length} still in 2+ classes`,
      "",
    ];
    stillDoubled.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.name}${r.member_number ? ` (Member #${r.member_number})` : ""}`);
      for (const e of aliveEntries(r)) {
        const car = e.car_number ? `#${e.car_number}` : "no car #";
        lines.push(`     ${e.category} — ${car} (${aliveRoundLabel(e)})`);
      }
    });
    return lines.join("\n");
  }

  async function copyList() {
    if (stillDoubled.length === 0) { flash("No racers are doubled up right now"); return; }
    try {
      await navigator.clipboard.writeText(buildCopyText());
      flash("Copied to clipboard");
    } catch {
      flash("Copy failed — use Print sheet instead");
    }
  }

  // Neat, printable staging-lane checklist: one row per class each doubled-up
  // racer still has to run, with a box to check off as they complete each.
  function printSheet() {
    if (stillDoubled.length === 0) { flash("No racers are doubled up right now"); return; }
    const when = new Date().toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const title = live.config?.eventName || selectedEvent;
    const body = stillDoubled
      .map((r, gi) =>
        aliveEntries(r)
          .map(
            (e, j) => `
          <tr class="${j === 0 && gi > 0 ? "grp" : ""}">
            <td class="chk"><span class="box"></span></td>
            <td class="racer">${j === 0 ? escapeHtml(r.name) + (r.member_number ? ` <span class="mem">#${escapeHtml(r.member_number)}</span>` : "") : ""}</td>
            <td class="car">${e.car_number ? "#" + escapeHtml(e.car_number) : "—"}</td>
            <td>${escapeHtml(e.category)}</td>
            <td class="round">${escapeHtml(aliveRoundLabel(e))}</td>
          </tr>`,
          )
          .join(""),
      )
      .join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Doubled Up — Staging Sheet</title>
      <style>
        @page { size: letter portrait; margin: 0.55in 0.6in; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .head { border-bottom: 3px solid #000; padding-bottom: 8pt; }
        .head h1 { font-size: 20pt; margin: 0; letter-spacing: .05em; }
        .head .st { font-size: 10pt; font-weight: bold; color: #C8102E; letter-spacing: .16em; text-transform: uppercase; margin-top: 3pt; }
        .head .meta { font-size: 10pt; color: #333; margin-top: 7pt; display: flex; justify-content: space-between; gap: 12pt; }
        .head .meta b { color: #000; }
        .note { font-size: 9pt; color: #555; font-style: italic; margin: 8pt 0 10pt; }
        table { width: 100%; border-collapse: collapse; }
        thead th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; border-bottom: 2px solid #000; padding: 5pt 6pt; }
        thead th.c { text-align: center; width: 0.55in; }
        tbody td { padding: 8pt 6pt; border-bottom: 1px solid #d3d3d3; font-size: 11.5pt; vertical-align: middle; }
        tbody tr.grp td { border-top: 2px solid #000; }
        td.chk { text-align: center; }
        .box { display: inline-block; width: 16pt; height: 16pt; border: 1.5px solid #000; border-radius: 3px; }
        .racer { font-weight: bold; white-space: nowrap; }
        .racer .mem { font-weight: normal; font-size: 9pt; color: #666; }
        .car { font-weight: bold; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .round { color: #333; white-space: nowrap; }
        @media screen { body { background: #e9e9e9; padding: 20px; } .page { background: #fff; max-width: 8.5in; margin: 0 auto; padding: 0.55in 0.6in; box-shadow: 0 0 10px #0004; } }
      </style></head>
      <body><div class="page">
        <div class="head">
          <h1>DOUBLED UP</h1>
          <div class="st">Staging Lane Sheet</div>
          <div class="meta"><span><b>${escapeHtml(title)}</b>${selectedSeason ? " · " + escapeHtml(selectedSeason) : ""}</span><span>${escapeHtml(when)} · <b>${stillDoubled.length}</b> racers</span></div>
        </div>
        <div class="note">Each racer is still alive in 2 or more classes. Check the box as they complete each class's run.</div>
        <table>
          <thead><tr><th class="c">Done</th><th>Racer</th><th>Car #</th><th>Class</th><th>Round</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };<\/script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { flash("Pop-up blocked — allow pop-ups to print"); return; }
    w.document.write(html);
    w.document.close();
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Doubled Up</h1>
          <p className="text-gray-400">
            Racers entered in more than one class — who&apos;s still in both, and who&apos;s already lost
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={load}
              disabled={loading || !selectedEvent}
              className="px-4 py-2 bg-nhra-red text-white rounded-lg font-bold text-sm hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            {stillDoubled.length > 0 && (
              <>
                <button
                  onClick={copyList}
                  className="px-4 py-2 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg font-bold text-sm hover:text-white transition-colors"
                >
                  Copy list
                </button>
                <button
                  onClick={printSheet}
                  className="px-4 py-2 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg font-bold text-sm hover:text-white transition-colors"
                >
                  Print sheet
                </button>
              </>
            )}
            {racers.length > 0 && (
              <button
                onClick={exportCsv}
                className="px-4 py-2 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg font-bold text-sm hover:text-white transition-colors"
              >
                Export CSV
              </button>
            )}
          </div>
          {notice && <span className="text-xs font-semibold text-nhra-accent">{notice}</span>}
        </div>
      </div>

      {!selectedEvent && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl px-6 py-10 text-center">
          <p className="text-gray-400">Set up a live event on the Dashboard first</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-xl px-6 py-4 mb-6 text-red-400 text-sm font-medium">
          {error}
        </div>
      )}

      {loading && !searched && (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {searched && racers.length === 0 && !loading && (
        <div className="bg-nhra-card border-2 border-green-500/30 rounded-xl px-6 py-10 text-center">
          <div className="w-4 h-4 bg-green-500 rounded-full mx-auto mb-3" />
          <p className="text-green-400 font-bold text-lg mb-1">No doubled-up racers</p>
          <p className="text-gray-500 text-sm">
            Nobody at this event has runs in more than one class
          </p>
        </div>
      )}

      {racers.length > 0 && (
        <>
          <div className="bg-nhra-card border border-nhra-border rounded-xl px-6 py-4 mb-8 flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-2xl font-bold text-white">{racers.length}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Doubled entries</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-yellow-400">{stillDoubled.length}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Still in 2+ classes</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-400">{downToOne.length}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Down to one</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-400">{done.length}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Done</p>
            </div>
          </div>

          {stillDoubled.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-bold text-yellow-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                Still in multiple classes — expect waits
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {stillDoubled.map((r) => (
                  <RacerCard key={r.name} racer={r} />
                ))}
              </div>
            </div>
          )}

          {downToOne.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-bold text-green-400 uppercase tracking-wider mb-3">
                Down to one class
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {downToOne.map((r) => (
                  <RacerCard key={r.name} racer={r} />
                ))}
              </div>
            </div>
          )}

          {done.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">
                Done — out (or won) in every class
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {done.map((r) => (
                  <RacerCard key={r.name} racer={r} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
