"use client";

import { useState } from "react";
import Link from "next/link";

interface TechCardResult {
  car_number: string;
  first_name: string;
  last_name: string;
  category: string;
  class_name: string;
  member_number: string;
  city: string;
  state: string;
  engine_make: string;
  body_type: string;
  hp: string;
  owner: string;
  crew_chief: string;
}

export default function RacerProfilePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TechCardResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/tech-cards?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Racer Profile</h1>
        <p className="text-gray-400">Search for a racer by name, car number, or category</p>
      </div>

      <form onSubmit={handleSearch} className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, car number, or category..."
            className="flex-1 px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-nhra-red hover:bg-nhra-red/80 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </form>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-10 h-10 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          No racers found matching &quot;{query}&quot;
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-4">
          {results.map((r, i) => (
            <Link
              key={i}
              href={`/racer/${encodeURIComponent(`${r.first_name} ${r.last_name}`)}`}
              className="block bg-nhra-card border border-nhra-border rounded-xl p-5 hover:border-nhra-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white">{r.first_name} {r.last_name}</h3>
                  <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                    <span className="text-nhra-accent font-bold">#{r.car_number}</span>
                    <span>{r.category}</span>
                    {r.class_name && <span className="text-gray-500">{r.class_name}</span>}
                  </div>
                </div>
                {r.member_number && (
                  <span className="text-xs text-gray-500 bg-nhra-darker px-2 py-1 rounded">Member #{r.member_number}</span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs text-gray-500">
                {r.city && r.state && <span>{r.city}, {r.state}</span>}
                {r.engine_make && <span>Engine: {r.engine_make}</span>}
                {r.body_type && <span>Body: {r.body_type}</span>}
                {r.hp && <span>{r.hp} HP</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
