"use client";

import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon?: ReactNode;
}

export function StatCard({ label, value, sub, color = "nhra-accent", icon }: StatCardProps) {
  return (
    <div className="relative overflow-hidden bg-nhra-card border border-nhra-border rounded-xl p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.7rem] font-semibold text-gray-400 uppercase tracking-[0.12em]">{label}</p>
        {icon && (
          <span className="-mt-1 -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-nhra-accent/10 text-nhra-accent ring-1 ring-inset ring-nhra-accent/20">
            {icon}
          </span>
        )}
      </div>
      <p className={`mt-1 font-display text-[1.9rem] font-bold leading-tight tabular-nums text-${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

interface HighlightCardProps {
  title: string;
  value: string;
  racerName: string;
  category: string;
  event?: string;
  accentColor: string;
}

export function HighlightCard({ title, value, racerName, category, event, accentColor }: HighlightCardProps) {
  return (
    <div className="relative overflow-hidden bg-nhra-card border border-nhra-border rounded-xl p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${accentColor}, transparent 85%)` }} />
      <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full opacity-20 blur-3xl" style={{ backgroundColor: accentColor }} />
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
          <p className="text-[0.7rem] font-semibold text-gray-400 uppercase tracking-[0.12em]">{title}</p>
        </div>
        <p className="mt-2 font-display text-[2.6rem] font-bold leading-none tabular-nums text-white">{value}</p>
        <p className="text-sm text-gray-300 mt-4 font-semibold">{racerName}</p>
        <p className="text-xs text-gray-500 mt-0.5">{category}{event ? ` | ${event}` : ""}</p>
      </div>
    </div>
  );
}
