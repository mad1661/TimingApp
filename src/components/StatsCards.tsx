"use client";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

export function StatCard({ label, value, sub, color = "nhra-accent" }: StatCardProps) {
  return (
    <div className="bg-nhra-card border border-nhra-border rounded-xl p-5">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold text-${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
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
    <div className={`bg-nhra-card border border-nhra-border rounded-xl p-5 relative overflow-hidden`}>
      <div className={`absolute top-0 left-0 w-1 h-full`} style={{ backgroundColor: accentColor }} />
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">{title}</p>
      <p className="text-3xl font-bold text-white">{value}</p>
      <p className="text-sm text-gray-300 mt-2 font-medium">{racerName}</p>
      <p className="text-xs text-gray-500">{category}{event ? ` | ${event}` : ""}</p>
    </div>
  );
}
