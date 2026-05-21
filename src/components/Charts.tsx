"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, LineChart, Line, Legend, LabelList, Cell,
} from "recharts";

const AXIS = "#94a3b8";
const GRID = "#33384f";
const TOOLTIP = { backgroundColor: "#12121f", border: "1px solid #33384f", borderRadius: 8, color: "#e2e8f0", fontSize: 13 };
const RED = "#ef4444";
const GREEN = "#22c55e";

interface ChartContainerProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  height?: number;
}

export function ChartContainer({ title, subtitle, children, height = 320 }: ChartContainerProps) {
  return (
    <div className="bg-nhra-card border border-nhra-border rounded-xl p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5 mb-2">{subtitle}</p>}
      <div className={subtitle ? "" : "mt-3"} style={{ height }}>{children}</div>
    </div>
  );
}

// ---- Horizontal bar chart: category labels on the Y axis stay readable (no
// rotated/overlapping text), values labelled at the end of each bar, and the
// best bar is highlighted. Used by the class-aware Statistics page. ----
interface HorizontalBarRow {
  category: string;
  [key: string]: string | number | null;
}

export function HorizontalBarChart({
  data, dataKey, color = "#C8102E", unit = "", decimals = 3, best,
}: {
  data: HorizontalBarRow[];
  dataKey: string;
  color?: string;
  unit?: string;
  decimals?: number;
  best?: "min" | "max";
}) {
  const rows = data.filter((d) => d[dataKey] != null && !Number.isNaN(Number(d[dataKey])));
  if (rows.length === 0) {
    return <div className="h-full flex items-center justify-center text-gray-600 text-sm">No data</div>;
  }
  const values = rows.map((r) => Number(r[dataKey]));
  const bestVal = best === "min" ? Math.min(...values) : best === "max" ? Math.max(...values) : null;
  const fmtVal = (v: unknown): string => {
    if (v === null || v === undefined || v === "") return "";
    const n = Number(v);
    return Number.isNaN(n) ? "" : `${n.toFixed(decimals)}${unit}`;
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 52, left: 8, bottom: 4 }} barCategoryGap="22%">
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={{ fill: AXIS, fontSize: 12 }} tickFormatter={(v) => `${v}${unit}`} />
        <YAxis type="category" dataKey="category" tick={{ fill: "#e2e8f0", fontSize: 13 }} width={72} />
        <Tooltip contentStyle={TOOLTIP} formatter={fmtVal} cursor={{ fill: "#ffffff10" }} />
        <Bar dataKey={dataKey} radius={[0, 4, 4, 0]} maxBarSize={26} isAnimationActive={false}>
          {rows.map((r, i) => (
            <Cell key={i} fill={bestVal !== null && Number(r[dataKey]) === bestVal ? GREEN : color} />
          ))}
          <LabelList dataKey={dataKey} position="right" fill="#cbd5e1" fontSize={12} formatter={fmtVal} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface CategoryBarChartProps {
  data: ({ category: string; count: number } & Record<string, number | null | string>)[];
  dataKey: string;
  label: string;
  color?: string;
}

// Kept for backward compatibility; now renders as a clean horizontal bar.
export function CategoryBarChart({ data, dataKey, label, color = "#C8102E" }: CategoryBarChartProps) {
  void label;
  return <HorizontalBarChart data={data as HorizontalBarRow[]} dataKey={dataKey} color={color} />;
}

interface ScatterDataPoint { x: number; y: number; name?: string }

export function RTvsETScatter({ data }: { data: ScatterDataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 16, left: 12, bottom: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
        <XAxis dataKey="x" name="RT" tick={{ fill: AXIS, fontSize: 12 }} label={{ value: "Reaction Time", position: "bottom", fill: AXIS, fontSize: 12 }} />
        <YAxis dataKey="y" name="ET" tick={{ fill: AXIS, fontSize: 12 }} label={{ value: "ET (1320ft)", angle: -90, position: "insideLeft", fill: AXIS, fontSize: 12 }} />
        <Tooltip contentStyle={TOOLTIP} cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={data} fill="#C8102E" fillOpacity={0.65} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

interface PerformanceLineData { label: string; value: number }

export function PerformanceLineChart({ data, dataKey = "value", color = "#C8102E", yLabel }: {
  data: PerformanceLineData[]; dataKey?: string; color?: string; yLabel?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: 12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
        <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis tick={{ fill: AXIS, fontSize: 12 }} domain={["auto", "auto"]}
          label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fill: AXIS, fontSize: 12 } : undefined} />
        <Tooltip contentStyle={TOOLTIP} />
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} dot={{ r: 3, fill: color }} activeDot={{ r: 6 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

interface MultiLineData { label: string; [key: string]: string | number | null }

export function MultiLineChart({ data, lines }: {
  data: MultiLineData[]; lines: { key: string; label: string; color: string }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: 12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
        <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis tick={{ fill: AXIS, fontSize: 12 }} domain={["auto", "auto"]} />
        <Tooltip contentStyle={TOOLTIP} />
        <Legend wrapperStyle={{ color: AXIS, fontSize: 13, paddingTop: 8 }} />
        {lines.map((line) => (
          <Line key={line.key} type="monotone" dataKey={line.key} name={line.label} stroke={line.color} strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 6 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export { RED, GREEN };
