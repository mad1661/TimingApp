import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Better Design's Linear "Empty" (MIT, see ./LICENSE): dashed panel, boxed
// icon, title, one line of help, optional action.
interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  /** "inline" drops the panel chrome, for use inside a table or card. */
  variant?: "panel" | "inline";
  className?: string;
}

export default function EmptyState({ title, description, icon, action, variant = "panel", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 text-center",
        variant === "panel"
          ? "rounded-xl border border-dashed border-nhra-border bg-[var(--ui-head-bg)] px-6 py-12"
          : "px-4 py-10",
        className,
      )}
    >
      {icon && (
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-nhra-border bg-nhra-darker text-gray-500 shadow-[var(--ui-shadow-raised)] [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </div>
      )}
      <div className="flex max-w-md flex-col gap-1">
        <p className="text-sm font-semibold text-white">{title}</p>
        {description && <p className="text-sm leading-relaxed text-gray-500">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Stroke icons sized for EmptyState's icon box. */
export function EmptyIcon({ d }: { d: string }) {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d={d} />
    </svg>
  );
}

export const EMPTY_ICONS = {
  runs: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  chart: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  flag: "M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9",
  clock: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  users: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
} as const;
