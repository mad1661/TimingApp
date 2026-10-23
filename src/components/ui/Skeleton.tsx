import { cn } from "@/lib/cn";

// Better Design's Linear "Skeleton" (MIT, see ./LICENSE).
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton animate-pulse", className)} />;
}

const CELL_WIDTHS = ["w-24", "w-32", "w-16", "w-10", "w-12", "w-14", "w-20", "w-12"];

/** Placeholder rows for a table body while its first page of data loads. */
export function SkeletonRows({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c}>
              <Skeleton className={cn("h-3.5", CELL_WIDTHS[(c + r) % CELL_WIDTHS.length], c > 1 && "ml-auto")} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Thin indeterminate bar for a refresh that keeps the current rows on screen. */
export function RefreshBar({ active, className }: { active: boolean; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("h-0.5 overflow-hidden", className)}>
      {active && <div className="h-full w-1/3 animate-progress-slide rounded-full bg-nhra-accent/70" />}
    </div>
  );
}
