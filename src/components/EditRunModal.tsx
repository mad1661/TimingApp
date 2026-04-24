"use client";

import { useState } from "react";

export interface EditableRun {
  _dedup_key?: string;
  timestamp: string | null;
  round: string | null;
  car_number: string | null;
  name: string | null;
  class_index: string | null;
  category: string | null;
  lane: string | null;
  rt: number | null;
  ft60: number | null;
  ft330: number | null;
  ft660: number | null;
  mph_660: number | null;
  ft1000: number | null;
  mph_1000: number | null;
  ft1320: number | null;
  mph_1320: number | null;
  dial_in: number | null;
  is_winner: number;
  is_dq: number;
  result: string | null;
  manual_run_number?: number | null;
}

interface Props {
  run: EditableRun;
  eventCode: string;
  season: string;
  onClose: () => void;
  onSaved: () => void;
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
  if (v === "" || v == null) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

export default function EditRunModal({ run, eventCode, season, onClose, onSaved }: Props) {
  const [form, setForm] = useState<EditableRun>({ ...run });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof EditableRun>(k: K, v: EditableRun[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    if (!run._dedup_key) { setError("Missing dedup key"); return; }
    setSaving(true);
    setError(null);
    const updates: Record<string, unknown> = {
      car_number: form.car_number,
      name: form.name,
      class_index: form.class_index,
      category: form.category,
      round: form.round,
      lane: form.lane,
      rt: form.rt,
      ft60: form.ft60,
      ft330: form.ft330,
      ft660: form.ft660,
      mph_660: form.mph_660,
      ft1000: form.ft1000,
      mph_1000: form.mph_1000,
      ft1320: form.ft1320,
      mph_1320: form.mph_1320,
      dial_in: form.dial_in,
      is_winner: form.is_winner,
      is_dq: form.is_dq,
      result: form.result,
      manual_run_number: form.manual_run_number ?? null,
    };
    try {
      const res = await fetch("/api/edit-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_code: eventCode, season, dedup_key: run._dedup_key, updates }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-nhra-dark border border-nhra-border rounded-xl w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-white">Edit Run</h2>
            <p className="text-xs text-gray-500 mt-0.5">{run.timestamp} &middot; {run.category || "—"} &middot; {run.round || "—"} &middot; Lane {run.lane || "—"}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Car #">
            <input value={form.car_number ?? ""} onChange={(e) => set("car_number", e.target.value)} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm" />
          </Field>
          <Field label="Name">
            <input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm" />
          </Field>
          <Field label="Class">
            <input value={form.class_index ?? ""} onChange={(e) => set("class_index", e.target.value)} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm" />
          </Field>
          <Field label="Lane">
            <input value={form.lane ?? ""} onChange={(e) => set("lane", e.target.value)} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm" />
          </Field>

          <Field label="Category">
            <input value={form.category ?? ""} onChange={(e) => set("category", e.target.value)} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm" />
          </Field>
          <Field label="Round">
            <input value={form.round ?? ""} onChange={(e) => set("round", e.target.value)} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm" />
          </Field>
          <Field label="Dial-In">
            <input type="number" step="0.001" value={form.dial_in ?? ""} onChange={(e) => set("dial_in", numOrNull(e.target.value))} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>
          <Field label="R/T">
            <input type="number" step="0.001" value={form.rt ?? ""} onChange={(e) => set("rt", numOrNull(e.target.value))} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>

          <Field label="60'">
            <input type="number" step="0.001" value={form.ft60 ?? ""} onChange={(e) => set("ft60", numOrNull(e.target.value))} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>
          <Field label="330'">
            <input type="number" step="0.001" value={form.ft330 ?? ""} onChange={(e) => set("ft330", numOrNull(e.target.value))} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>
          <Field label="660' (1/8)">
            <input type="number" step="0.001" value={form.ft660 ?? ""} onChange={(e) => set("ft660", numOrNull(e.target.value))} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>
          <Field label="660 MPH">
            <input type="number" step="0.01" value={form.mph_660 ?? ""} onChange={(e) => set("mph_660", numOrNull(e.target.value))} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>

          <Field label="1000'">
            <input type="number" step="0.001" value={form.ft1000 ?? ""} onChange={(e) => set("ft1000", numOrNull(e.target.value))} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>
          <Field label="1000 MPH">
            <input type="number" step="0.01" value={form.mph_1000 ?? ""} onChange={(e) => set("mph_1000", numOrNull(e.target.value))} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>
          <Field label="ET (1320)">
            <input type="number" step="0.001" value={form.ft1320 ?? ""} onChange={(e) => set("ft1320", numOrNull(e.target.value))} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>
          <Field label="1320 MPH">
            <input type="number" step="0.01" value={form.mph_1320 ?? ""} onChange={(e) => set("mph_1320", numOrNull(e.target.value))} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>

          <Field label="Winner (0/1)">
            <input type="number" min={0} max={1} step={1} value={form.is_winner} onChange={(e) => set("is_winner", parseInt(e.target.value || "0", 10))} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>
          <Field label="DQ (0/1)">
            <input type="number" min={0} max={1} step={1} value={form.is_dq} onChange={(e) => set("is_dq", parseInt(e.target.value || "0", 10))} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>
          <Field label="Result (W/R/3/4)">
            <input value={form.result ?? ""} onChange={(e) => set("result", e.target.value.toUpperCase())} className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm" />
          </Field>
          <Field label="Run # override">
            <input type="number" step={1} value={form.manual_run_number ?? ""} onChange={(e) => set("manual_run_number", e.target.value === "" ? null : parseInt(e.target.value, 10))} placeholder="auto" className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono" />
          </Field>
        </div>

        {error && <p className="text-red-400 text-sm mt-4">{error}</p>}

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-nhra-red text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
