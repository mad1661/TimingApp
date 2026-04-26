"use client";

import { useEffect, useState, useRef } from "react";
import { useLiveData } from "@/components/LiveDataProvider";

interface UploadResult {
  success: boolean;
  total: number;
  saved: number;
  skipped: number;
  preview: { name: string; car_number: string; category: string; member_number: string }[];
}

export default function TechCardsPage() {
  const live = useLiveData();
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");
  const [eventName, setEventName] = useState("");
  const [autoFilledEvent, setAutoFilledEvent] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Pre-fill the event name from the currently loaded event so uploads
  // automatically tag tech cards with the right event without the user
  // having to type it every time. Manual edits override.
  useEffect(() => {
    const liveEventName = live.config?.eventName?.trim();
    if (!liveEventName) return;
    setEventName((prev) => {
      if (prev === "" || autoFilledEvent) {
        setAutoFilledEvent(true);
        return liveEventName;
      }
      return prev;
    });
  }, [live.config?.eventName, autoFilledEvent]);

  async function handleUpload(file: File) {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      setError("Please upload an Excel file (.xlsx or .xls)");
      return;
    }

    setUploading(true);
    setError("");
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    if (eventName) formData.append("event_name", eventName);

    try {
      const res = await fetch("/api/tech-cards", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed");
      } else {
        setResult(data);
      }
    } catch (err) {
      console.error(err);
      setError("Upload failed. Check the file format and try again.");
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Tech Card Upload</h1>
        <p className="text-gray-400">
          Upload Compulink tech card data (.xlsx) to add racer profiles, membership numbers, and vehicle info
        </p>
      </div>

      {/* Event Name */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <label className="block text-sm text-gray-400">Event Name</label>
          {autoFilledEvent && live.config?.eventName && (
            <span className="text-[10px] uppercase tracking-wider text-green-400">
              Auto-filled from current event
            </span>
          )}
        </div>
        <input
          type="text"
          value={eventName}
          onChange={(e) => {
            setEventName(e.target.value);
            setAutoFilledEvent(false);
          }}
          placeholder={
            live.config?.eventName
              ? live.config.eventName
              : "e.g. No Problem Raceway Park - Mar 27 thru Mar 29"
          }
          className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
        />
        <p className="text-xs text-gray-500 mt-2">
          Tagged on every uploaded tech card so the &quot;Missing From Eliminations&quot; check on /noshows can scope to the right event.
        </p>
      </div>

      {/* Upload Area */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`bg-nhra-card border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
          dragOver
            ? "border-nhra-accent bg-nhra-accent/5"
            : "border-nhra-border hover:border-nhra-accent/50 hover:bg-nhra-darker"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileChange}
          className="hidden"
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400">Processing tech card data...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <svg className="w-16 h-16 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <div>
              <p className="text-white font-medium text-lg">Drop Compulink Excel file here</p>
              <p className="text-gray-500 text-sm mt-1">or click to browse (.xlsx, .xls)</p>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="mt-6 space-y-4">
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6">
            <h3 className="text-green-400 font-bold text-lg mb-2">Upload Complete</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-white">{result.total}</p>
                <p className="text-xs text-gray-500 uppercase">Total Rows</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-400">{result.saved}</p>
                <p className="text-xs text-gray-500 uppercase">Saved</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-500">{result.skipped}</p>
                <p className="text-xs text-gray-500 uppercase">Skipped</p>
              </div>
            </div>
          </div>

          {/* Preview */}
          {result.preview.length > 0 && (
            <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
              <div className="px-6 py-3 bg-nhra-darker border-b border-nhra-border">
                <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Preview (first {result.preview.length})</h4>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nhra-border text-gray-500 text-xs uppercase">
                    <th className="px-6 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">Car #</th>
                    <th className="px-4 py-2 text-left">Category</th>
                    <th className="px-4 py-2 text-left">Member #</th>
                  </tr>
                </thead>
                <tbody>
                  {result.preview.map((p, i) => (
                    <tr key={i} className="border-b border-nhra-border/30">
                      <td className="px-6 py-2 text-white">{p.name}</td>
                      <td className="px-4 py-2 text-nhra-accent font-bold">#{p.car_number}</td>
                      <td className="px-4 py-2 text-gray-300">{p.category}</td>
                      <td className="px-4 py-2 text-gray-300">{p.member_number || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      <div className="mt-8 bg-nhra-card border border-nhra-border rounded-xl p-6">
        <h4 className="text-sm font-bold text-gray-400 mb-3 uppercase tracking-wider">Compulink Format</h4>
        <div className="text-sm text-gray-500 space-y-1">
          <p>Upload the Compulink tech card export (.xlsx). Expected columns include:</p>
          <p className="text-gray-400">Car Number, First Name, Last Name, City, State, Category, Class, Engine Make, Body Type, Member #, Owner, Crew Chief, HP, and bio lines.</p>
          <p>If a racer with the same car number and category already exists, their data will be updated.</p>
        </div>
      </div>
    </div>
  );
}
