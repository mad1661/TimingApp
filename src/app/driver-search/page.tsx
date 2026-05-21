"use client";

import { useState } from "react";

interface TechCard {
  id?: string;
  car_number: string;
  first_name: string;
  last_name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  occupation: string;
  license_number: string;
  license_expiry: string;
  home_division: string;
  owner: string;
  crew_chief: string;
  category: string;
  class_name: string;
  engine_make: string;
  engine_year: string;
  body_type: string;
  body_year: string;
  cu_cc: string;
  hp: string;
  factored_hp: string;
  member_number: string;
  member_expiry: string;
  payee: string;
  bio_lines: string[];
  submission_date: string;
  event_name?: string;
  phone?: string;
  email?: string;
  payee_street?: string;
  payee_city?: string;
  payee_state?: string;
  payee_zip?: string;
}

function joinAddr(parts: (string | undefined)[]): string {
  return parts.map((p) => (p || "").trim()).filter(Boolean).join(", ");
}

export default function DriverSearchPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TechCard[] | null>(null);
  const [error, setError] = useState("");

  async function search() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/tech-cards?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Search failed");
        setResults(null);
      } else {
        setResults(data.results || []);
      }
    } catch {
      setError("Search failed. Try again.");
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1 sm:mb-2">Driver Search</h1>
        <p className="text-sm sm:text-base text-gray-400">
          Search tech cards by name, car number, or member number to see a racer&apos;s full profile.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") search(); }}
          placeholder="Name, car #, or member #"
          className="flex-1 px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
        />
        <button
          onClick={search}
          disabled={loading || !query.trim()}
          className="px-6 py-3 bg-nhra-red text-white rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg text-sm bg-red-500/10 text-red-400 border border-red-500/20">{error}</div>
      )}

      {results && results.length === 0 && (
        <div className="px-4 py-8 text-center text-gray-500 bg-nhra-card border border-nhra-border rounded-xl">
          No tech cards found for &quot;{query}&quot;.
        </div>
      )}

      {results && results.length > 0 && (
        <div className="space-y-5">
          <p className="text-xs text-gray-500">{results.length} result{results.length === 1 ? "" : "s"}</p>
          {results.map((t, i) => (
            <ProfileCard key={t.id || i} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileCard({ t }: { t: TechCard }) {
  const driverAddr = joinAddr([t.street, t.city, t.state, t.zip]);
  const payeeAddr = joinAddr([t.payee_street, t.payee_city, t.payee_state, t.payee_zip]);
  const vehicle = [t.engine_make, t.engine_year].filter(Boolean).join(" ");
  const bio = (t.bio_lines || []).filter(Boolean);

  return (
    <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
      <div className="px-5 sm:px-6 py-4 bg-nhra-darker border-b border-nhra-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white">{t.first_name} {t.last_name}</h2>
          <p className="text-xs text-gray-500">
            {t.category}{t.class_name ? ` · ${t.class_name}` : ""}{t.event_name ? ` · ${t.event_name}` : ""}
          </p>
        </div>
        <div className="text-right">
          {t.car_number && <p className="text-nhra-accent font-bold font-mono">#{t.car_number}</p>}
          {t.member_number && <p className="text-xs text-gray-500">Member {t.member_number}</p>}
        </div>
      </div>

      <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
        <Section title="Contact">
          <Field label="Phone" value={t.phone} />
          <Field label="Email" value={t.email} />
          <Field label="Address" value={driverAddr} />
          <Field label="Home Division" value={t.home_division} />
          <Field label="Occupation" value={t.occupation} />
        </Section>

        <Section title="Vehicle">
          <Field label="Engine" value={vehicle} />
          <Field label="CU/CC" value={t.cu_cc} />
          <Field label="Body" value={[t.body_type, t.body_year].filter(Boolean).join(" ")} />
          <Field label="HP" value={t.hp} />
          <Field label="Factored HP" value={t.factored_hp} />
        </Section>

        <Section title="Membership & License">
          <Field label="Member #" value={t.member_number} />
          <Field label="Member Expiry" value={t.member_expiry} />
          <Field label="License #" value={t.license_number} />
          <Field label="License Expiry" value={t.license_expiry} />
        </Section>

        <Section title="Team">
          <Field label="Owner" value={t.owner} />
          <Field label="Crew Chief" value={t.crew_chief} />
          <Field label="Payee" value={t.payee} />
          <Field label="Payee Address" value={payeeAddr} />
        </Section>

        {bio.length > 0 && (
          <Section title="Bio" full>
            {bio.map((line, i) => <p key={i} className="text-sm text-gray-300">{line}</p>)}
          </Section>
        )}
      </div>

      {t.submission_date && (
        <div className="px-5 sm:px-6 py-2 border-t border-nhra-border text-xs text-gray-600">
          Submitted {t.submission_date}
        </div>
      )}
    </div>
  );
}

function Section({ title, full, children }: { title: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={`mb-3 ${full ? "sm:col-span-2" : ""}`}>
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value || !value.trim()) return null;
  return (
    <div className="flex justify-between gap-3 py-0.5 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-white text-right break-words">{value}</span>
    </div>
  );
}
