"use client";

import { useEffect, useMemo, useState } from "react";

interface TechCard {
  id?: string;
  first_name: string;
  last_name: string;
  member_number: string;
  category: string;
  home_division: string;
  event_name?: string;
  email?: string;
  phone?: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  payee?: string;
  payee_street?: string;
  payee_city?: string;
  payee_state?: string;
  payee_zip?: string;
  uploaded_at?: string;
}

function importYear(t: { uploaded_at?: string }): string {
  if (!t.uploaded_at) return "";
  const y = new Date(t.uploaded_at).getFullYear();
  return Number.isNaN(y) ? "" : String(y);
}

interface Contact {
  key: string;
  name: string;
  member_number: string;
  categories: string[];
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

function rowAddress(t: TechCard) {
  if ((t.street || "").trim()) return { street: t.street, city: t.city, state: t.state, zip: t.zip };
  return { street: t.payee_street || "", city: t.payee_city || "", state: t.payee_state || "", zip: t.payee_zip || "" };
}

function uniqSorted(values: (string | undefined)[]): string[] {
  return [...new Set(values.map((v) => (v || "").trim()).filter(Boolean))].sort();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

export default function ContactsPage() {
  const [cards, setCards] = useState<TechCard[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [divs, setDivs] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<Set<string>>(new Set());
  const [years, setYears] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState("");

  useEffect(() => {
    fetch("/api/tech-cards?all=1")
      .then((r) => r.json())
      .then((data) => setCards(data.results || []))
      .catch(() => setError("Could not load tech cards."));
  }, []);

  const catOptions = useMemo(() => uniqSorted((cards || []).map((c) => c.category)), [cards]);
  const divOptions = useMemo(() => uniqSorted((cards || []).map((c) => c.home_division)), [cards]);
  const eventOptions = useMemo(() => uniqSorted((cards || []).map((c) => c.event_name)), [cards]);
  const yearOptions = useMemo(() => uniqSorted((cards || []).map((c) => importYear(c))).reverse(), [cards]);

  // Apply filters to raw rows, then collapse to one contact per person.
  const contacts = useMemo<Contact[]>(() => {
    if (!cards) return [];
    const q = search.trim().toLowerCase();
    const map = new Map<string, Contact>();
    for (const t of cards) {
      if (cats.size && !cats.has((t.category || "").trim())) continue;
      if (divs.size && !divs.has((t.home_division || "").trim())) continue;
      if (events.size && !events.has((t.event_name || "").trim())) continue;
      if (years.size && !years.has(importYear(t))) continue;
      const name = `${t.first_name || ""} ${t.last_name || ""}`.trim();
      if (q) {
        const hay = `${name} ${t.member_number || ""} ${t.email || ""} ${t.phone || ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const key = (t.member_number || "").trim() || name.toLowerCase();
      if (!key) continue;
      const a = rowAddress(t);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key, name, member_number: t.member_number || "",
          categories: t.category ? [t.category] : [],
          email: t.email || "", phone: t.phone || "",
          street: a.street, city: a.city, state: a.state, zip: a.zip,
        });
      } else {
        if (t.category && !existing.categories.includes(t.category)) existing.categories.push(t.category);
        if (!existing.email && t.email) existing.email = t.email;
        if (!existing.phone && t.phone) existing.phone = t.phone;
        if (!existing.street && a.street) { existing.street = a.street; existing.city = a.city; existing.state = a.state; existing.zip = a.zip; }
      }
    }
    return [...map.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [cards, search, cats, divs, events, years]);

  const selectedContacts = contacts.filter((c) => selected.has(c.key));
  const allSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.key));

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(contacts.map((c) => c.key)));
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("clipboard blocked — select the text below");
    }
  }

  const emails = selectedContacts.map((c) => c.email).filter(Boolean);
  const phones = selectedContacts.map((c) => c.phone).filter(Boolean);

  function printLabels() {
    const withAddr = selectedContacts.filter((c) => c.street && c.city);
    if (withAddr.length === 0) { setCopied("No selected contacts have a mailing address."); setTimeout(() => setCopied(""), 3000); return; }
    const labels = withAddr.map((c) => `
      <div class="label">
        <div class="nm">${escapeHtml(c.name)}</div>
        <div>${escapeHtml(c.street)}</div>
        <div>${escapeHtml(`${c.city}, ${c.state} ${c.zip}`.trim())}</div>
      </div>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Mailing Labels</title>
      <style>
        @page { size: letter; margin: 0.5in 0.18in; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
        .sheet { display: grid; grid-template-columns: repeat(3, 2.625in); grid-auto-rows: 1in; column-gap: 0.12in; }
        .label { padding: 0.12in 0.16in; overflow: hidden; font-size: 11pt; line-height: 1.25; }
        .nm { font-weight: bold; }
        @media screen { body { background: #eee; padding: 16px; } .sheet { background: #fff; padding: 0.5in 0.18in; box-shadow: 0 0 8px #0003; } }
      </style></head>
      <body><div class="sheet">${labels}</div>
      <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };<\/script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { setCopied("Pop-up blocked — allow pop-ups to print labels."); setTimeout(() => setCopied(""), 3000); return; }
    w.document.write(html);
    w.document.close();
  }

  if (error) return <div className="max-w-5xl mx-auto p-4 text-red-400">{error}</div>;
  if (!cards) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-12 h-12 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1 sm:mb-2">Contacts &amp; Mailing</h1>
        <p className="text-sm text-gray-400">Filter racers, then print envelope labels in bulk or pull everyone&apos;s email / phone to reach out.</p>
      </div>

      {/* Filters */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 sm:p-6 mb-6 space-y-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, member #, email, phone"
          className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent" />
        {yearOptions.length > 0 && <FilterRow label="Year imported" options={yearOptions} selected={years} onToggle={(v) => toggle(setYears, v)} />}
        <FilterRow label="Category" options={catOptions} selected={cats} onToggle={(v) => toggle(setCats, v)} />
        {divOptions.length > 0 && <FilterRow label="Division" options={divOptions} selected={divs} onToggle={(v) => toggle(setDivs, v)} />}
        {eventOptions.length > 0 && <FilterRow label="Event" options={eventOptions} selected={events} onToggle={(v) => toggle(setEvents, v)} />}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="text-sm text-gray-400">{selectedContacts.length} of {contacts.length} selected</span>
        <button onClick={printLabels} disabled={selectedContacts.length === 0}
          className="px-4 py-2.5 bg-nhra-red text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-40">
          Print Labels
        </button>
        <button onClick={() => copy(emails.join("; "), `${emails.length} emails copied`)} disabled={emails.length === 0}
          className="px-4 py-2.5 bg-nhra-card border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white transition-colors disabled:opacity-40">
          Copy Emails ({emails.length})
        </button>
        <button onClick={() => copy(phones.join(", "), `${phones.length} phones copied`)} disabled={phones.length === 0}
          className="px-4 py-2.5 bg-nhra-card border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white transition-colors disabled:opacity-40">
          Copy Phones ({phones.length})
        </button>
        {emails.length > 0 && (
          <a href={`mailto:?bcc=${encodeURIComponent(emails.join(","))}`}
            className="px-4 py-2.5 bg-nhra-card border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white transition-colors">
            Email Selected
          </a>
        )}
        {copied && <span className="text-xs text-green-400">{copied}</span>}
      </div>

      {/* List */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                <th className="p-3 pl-5 text-left w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Class(es)</th>
                <th className="p-3 text-left">Member #</th>
                <th className="p-3 text-left">Address</th>
                <th className="p-3 text-left">Email</th>
                <th className="p-3 text-left pr-5">Phone</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const hasAddr = c.street && c.city;
                return (
                  <tr key={c.key} className={`border-b border-nhra-border/40 hover:bg-nhra-border/20 ${selected.has(c.key) ? "bg-nhra-red/5" : ""}`}>
                    <td className="p-3 pl-5"><input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(setSelected, c.key)} /></td>
                    <td className="p-3 text-white font-medium">{c.name}</td>
                    <td className="p-3 text-gray-400">{c.categories.join(", ")}</td>
                    <td className="p-3 text-gray-400 font-mono">{c.member_number || "—"}</td>
                    <td className={`p-3 ${hasAddr ? "text-gray-300" : "text-gray-600"}`}>{hasAddr ? `${c.street}, ${c.city}, ${c.state} ${c.zip}` : "no address"}</td>
                    <td className="p-3 text-gray-300">{c.email || "—"}</td>
                    <td className="p-3 text-gray-300 pr-5">{c.phone || "—"}</td>
                  </tr>
                );
              })}
              {contacts.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">No contacts match the filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {emails.length > 0 && (
        <div className="mt-6 bg-nhra-card border border-nhra-border rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-2">Selected emails (if the copy button is blocked, select &amp; copy here):</p>
          <textarea readOnly value={emails.join("; ")} className="w-full h-20 bg-nhra-darker border border-nhra-border rounded-lg p-3 text-xs text-gray-300 font-mono" />
        </div>
      )}
    </div>
  );
}

function FilterRow({ label, options, selected, onToggle }: {
  label: string; options: string[]; selected: Set<string>; onToggle: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o} onClick={() => onToggle(o)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              selected.has(o) ? "bg-nhra-red text-white" : "bg-nhra-darker border border-nhra-border text-gray-400 hover:text-white"
            }`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
