"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState, { EmptyIcon, EMPTY_ICONS } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

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
      <div className="max-w-5xl mx-auto" aria-busy="true">
        <span className="sr-only">Loading events...</span>
        <PageHeader title="Events" description="Loading events..." />
        <div className="overflow-hidden rounded-xl border border-nhra-border bg-nhra-card divide-y divide-nhra-border/60">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-80 max-w-full" />
                <Skeleton className="mt-2 h-3 w-40" />
              </div>
              <Skeleton className="h-5 w-10 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const eventTypeLabels: Record<string, string> = {
    N: "National", D1: "Div 1", D2: "Div 2", D3: "Div 3",
    D4: "Div 4", D5: "Div 5", D6: "Div 6", D7: "Div 7",
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Events" description={`${events.length} events imported`} />

      {events.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon d={EMPTY_ICONS.flag} />}
          title="No events imported yet"
          description="Events show up here once their runs have been fetched or imported."
          action={<Link href="/import" className="btn btn-secondary">Import data</Link>}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-nhra-border bg-nhra-card divide-y divide-nhra-border/60">
          {events.map((event) => (
            <Link
              key={event.id}
              href={`/runs?event_code=${encodeURIComponent(event.event_code)}&season=${encodeURIComponent(event.season)}`}
              className="group flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-[var(--ui-row-hover)]"
            >
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium text-white group-hover:text-nhra-accent transition-colors">{event.event_name}</h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  {eventTypeLabels[event.event_type] || event.event_type} &middot; {event.season} &middot; {event.start_date}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="chip font-mono">{event.event_code}</span>
                <svg className="h-4 w-4 text-gray-600 transition-colors group-hover:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
