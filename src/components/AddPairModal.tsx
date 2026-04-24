"use client";

import { useState } from "react";

interface Props {
  eventCode: string;
  season: string;
  rounds: string[];
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}

interface LaneEntry {
  lane: string;
  car_number: string;
  name: string;
  class_index: string;
  dial_in: string;
  rt: string;
  ft60: string;
  ft330: string;
  ft660: string;
  mph_660: string;
  ft1000: string;
  mph_1000: string;
  ft1320: string;
  mph_1320: string;
  is_winner: boolean;
  is_dq: boolean;
}

function emptyLane(lane: string): LaneEntry {
  return {
    lane,
    car_number: "",
    name: "",
    class_index: "",
    dial_in: "",
    rt: "",
    ft60: "",
    ft330: "",
    ft660: "",
    mph_660: "",
    ft1000: "",
    mph_1000: "",
    ft1320: "",
    mph_1320: "",
    is_winner: false,
    is_dq: false,
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function numOrNull(v: string): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function nowTimestamp(): string {
  const d = new Date();
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const min = d.getMinutes().toString().padStart(2, "0");
  const sec = d.getSeconds().toString().padStart(2, "0");
  return `${mm}/${dd}/${yyyy} ${h}:${min}:${sec} ${ampm}`;
}

export default function AddPairModal({ eventCode, season, rounds, categories, onClose, onSaved }: Props) {
  const [timestamp, setTimestamp] = useState(nowTimestamp());
  const [round, setRound] = useState(rounds[0] || "");
  const [category, setCategory] = useState(categories[0] || "");
  const [lanes, setLanes] = useState<LaneEntry[]>([emptyLane("L"), emptyLane("R")]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLane(idx: number, patch: Partial<LaneEntry>) {
    setLanes((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLane() {
    if (lanes.length >= 4) return;
    setLanes((prev) => [...prev, emptyLane(String(prev.length + 1))]);
  }

  function removeLane(idx: number) {
    if (lanes.length <= 1) return;
    setLanes((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!round || !category) { setError("Round and category required"); return; }
    const populated = lanes.filter((l) => l.car_number.trim() || l.name.trim() || l.ft1320 || l.rt);
    if (populated.length === 0) { setError("At least one racer required"); return; }
    setSaving(true);
    setError(null);
    try {
      const runs = populated.map((l) => ({
        timestamp,
        round,
        category,
        lane: l.lane,
        car_number: l.car_number || null,
        name: l.name || null,
        class_index: l.class_index || null,
        dial_in: numOrNull(l.dial_in),
        rt: numOrNull(l.rt),
        ft60: numOrNull(l.ft60),
        ft330: numOrNull(l.ft330),
        ft660: numOrNull(l.ft660),
        mph_660: numOrNull(l.mph_660),
        ft1000: numOrNull(l.ft1000),
        mph_1000: numOrNull(l.mph_1000),
        ft1320: numOrNull(l.ft1320),
        mph_1320: numOrNull(l.mph_1320),
        is_winner: l.is_winner ? 1 : 0,
        is_dq: l.is_dq ? 1 : 0,
        result: l.is_winner ? "W" : null,
      }));
      const res = await fetch("/api/add-pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_code: eventCode, season, runs }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-nhra-dark border border-nhra-border rounded-xl w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-white">Add Pair</h2>
            <p className="text-xs text-gray-500 mt-0.5">Manually insert a race that wasn&apos;t captured by the timing system.</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <Field label="Timestamp (MM/DD/YYYY h:mm:ss AM/PM)">
            <input value={timestamp} onChange={(e) => setTimestamp(e.target.value)} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>
          <Field label="Round">
            <input value={round} list="add-pair-rounds" onChange={(e) => setRound(e.target.value)} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm" />
            <datalist id="add-pair-rounds">
              {rounds.map((r) => <option key={r} value={r} />)}
            </datalist>
          </Field>
          <Field label="Category">
            <input value={category} list="add-pair-cats" onChange={(e) => setCategory(e.target.value)} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm" />
            <datalist id="add-pair-cats">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
        </div>

        <div className="space-y-4">
          {lanes.map((lane, idx) => (
            <div key={idx} className="bg-nhra-darker rounded-lg border border-nhra-border p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white">Lane {lane.lane}</h3>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-gray-400">
                    <input type="checkbox" checked={lane.is_winner} onChange={(e) => updateLane(idx, { is_winner: e.target.checked })} />
                    Winner
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-400">
                    <input type="checkbox" checked={lane.is_dq} onChange={(e) => updateLane(idx, { is_dq: e.target.checked })} />
                    DQ
                  </label>
                  {lanes.length > 1 && (
                    <button onClick={() => removeLane(idx)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Field label="Lane">
                  <input value={lane.lane} onChange={(e) => updateLane(idx, { lane: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm" />
                </Field>
                <Field label="Car #">
                  <input value={lane.car_number} onChange={(e) => updateLane(idx, { car_number: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm" />
                </Field>
                <Field label="Name">
                  <input value={lane.name} onChange={(e) => updateLane(idx, { name: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm" />
                </Field>
                <Field label="Class">
                  <input value={lane.class_index} onChange={(e) => updateLane(idx, { class_index: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm" />
                </Field>

                <Field label="Dial">
                  <input type="number" step="0.001" value={lane.dial_in} onChange={(e) => updateLane(idx, { dial_in: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm font-mono" />
                </Field>
                <Field label="R/T">
                  <input type="number" step="0.001" value={lane.rt} onChange={(e) => updateLane(idx, { rt: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm font-mono" />
                </Field>
                <Field label="60'">
                  <input type="number" step="0.001" value={lane.ft60} onChange={(e) => updateLane(idx, { ft60: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm font-mono" />
                </Field>
                <Field label="330'">
                  <input type="number" step="0.001" value={lane.ft330} onChange={(e) => updateLane(idx, { ft330: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm font-mono" />
                </Field>

                <Field label="660' (1/8)">
                  <input type="number" step="0.001" value={lane.ft660} onChange={(e) => updateLane(idx, { ft660: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm font-mono" />
                </Field>
                <Field label="660 MPH">
                  <input type="number" step="0.01" value={lane.mph_660} onChange={(e) => updateLane(idx, { mph_660: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm font-mono" />
                </Field>
                <Field label="1000'">
                  <input type="number" step="0.001" value={lane.ft1000} onChange={(e) => updateLane(idx, { ft1000: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm font-mono" />
                </Field>
                <Field label="1000 MPH">
                  <input type="number" step="0.01" value={lane.mph_1000} onChange={(e) => updateLane(idx, { mph_1000: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm font-mono" />
                </Field>

                <Field label="ET (1320)">
                  <input type="number" step="0.001" value={lane.ft1320} onChange={(e) => updateLane(idx, { ft1320: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm font-mono" />
                </Field>
                <Field label="1320 MPH">
                  <input type="number" step="0.01" value={lane.mph_1320} onChange={(e) => updateLane(idx, { mph_1320: e.target.value })} className="px-2 py-1.5 bg-nhra-dark border border-nhra-border rounded text-white text-sm font-mono" />
                </Field>
              </div>
            </div>
          ))}
        </div>

        {lanes.length < 4 && (
          <button onClick={addLane} className="mt-3 px-3 py-1.5 text-xs text-nhra-accent hover:underline">+ Add lane (up to 4)</button>
        )}

        {error && <p className="text-red-400 text-sm mt-4">{error}</p>}

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-nhra-red text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50">{saving ? "Saving…" : "Add Pair"}</button>
        </div>
      </div>
    </div>
  );
}
