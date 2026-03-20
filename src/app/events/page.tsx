"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface EventRow {
  id: string;
  event_code: string;
  event_type: string;
  event_name: string;
  season: string;
  start_date: string;
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((data) => setEvents(data.events || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const eventTypeLabels: Record<string, string> = {
    N: "National", D1: "Div 1", D2: "Div 2", D3: "Div 3",
    D4: "Div 4", D5: "Div 5", D6: "Div 6", D7: "Div 7",
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Events</h1>
        <p className="text-gray-400">{events.length} events imported</p>
      </div>

      {events.length === 0 ? (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center">
          <p className="text-gray-500 mb-4">No events imported yet</p>
          <Link href="/import" className="text-nhra-accent hover:underline">Import data</Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {events.map((event) => (
            <Link
              key={event.id}
              href={`/runs?event_code=${encodeURIComponent(event.event_code)}&season=${encodeURIComponent(event.season)}`}
              className="bg-nhra-card border border-nhra-border rounded-xl p-5 hover:border-nhra-accent/50 transition-colors group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold group-hover:text-nhra-accent transition-colors">{event.event_name}</h3>
                  <p className="text-gray-400 text-sm mt-1">
                    {eventTypeLabels[event.event_type] || event.event_type} &middot; {event.season} &middot; {event.start_date}
                  </p>
                </div>
                <div className="text-right">
                  <span className="px-3 py-1 bg-nhra-darker text-gray-300 text-xs rounded-full">{event.event_code}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
