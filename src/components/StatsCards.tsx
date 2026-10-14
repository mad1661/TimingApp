"use client";

import type { ReactNode } from "react";
import { AnimatedNumber } from "@/components/motion/animated-number";

interface StatCardProps {
  label: string;
  /** Whole numbers tick to their new value when live data changes them. */
  value: string | number;
  sub?: string;
  color?: string;
  icon?: ReactNode;
}

export function StatCard({ label, value, sub, color = "nhra-accent", icon }: StatCardProps) {
  return (
    <div className="rounded-xl border border-nhra-border bg-nhra-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-gray-400">{label}</p>
        {icon && (
          <span className="-mt-0.5 -mr-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-nhra-border bg-[var(--ui-surface-raised)] text-gray-400">
            {icon}
          </span>
        )}
      </div>
      <p className={`mt-1.5 text-[1.65rem] font-semibold leading-tight tracking-tight tabular-nums text-${color}`}>
        {typeof value === "number" && Number.isInteger(value) ? <AnimatedNumber value={value} /> : value}
      </p>
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
    <div className="rounded-xl border border-nhra-border bg-nhra-card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
        <p className="text-xs font-medium text-gray-400">{title}</p>
      </div>
      <p className="mt-2.5 text-[2.1rem] font-semibold leading-none tracking-tight tabular-nums text-white">{value}</p>
      <p className="text-sm text-gray-300 mt-4 font-medium">{racerName}</p>
      <p className="text-xs text-gray-500 mt-0.5">{category}{event ? ` · ${event}` : ""}</p>
    </div>
  );
}
