"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, LineChart, Line, Legend, Cell
} from "recharts";

const COLORS = ["#C8102E", "#003DA5", "#22c55e", "#eab308", "#f97316", "#8b5cf6", "#ec4899", "#06b6d4"];

interface ChartContainerProps {
  title: string;
  children: React.ReactNode;
  height?: number;
}

export function ChartContainer({ title, children, height = 300 }: ChartContainerProps) {
  return (
    <div className="bg-nhra-card border border-nhra-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">{title}</h3>
      <div style={{ height }}>{children}</div>
    </div>
  );
}

interface CategoryBarChartProps {
  data: { category: string; bestET: number | null; avgRT: number | null; bestSpeed: number | null; count: number }[];
  dataKey: string;
  label: string;
  color?: string;
}

export function CategoryBarChart({ data, dataKey, label, color = "#C8102E" }: CategoryBarChartProps) {
  const filtered = data.filter((d) => (d as Record<string, unknown>)[dataKey] != null);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={filtered} margin={{ top: 5, right: 10, left: 10, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a44" />
        <XAxis dataKey="category" tick={{ fill: "#9ca3af", fontSize: 10 }} angle={-45} textAnchor="end" interval={0} />
        <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: "#1e1e32", border: "1px solid #2a2a44", borderRadius: 8, color: "#e2e8f0" }} />
        <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} name={label}>
          {filtered.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface ScatterDataPoint {
  x: number;
  y: number;
  name?: string;
}

interface RTvsETScatterProps {
  data: ScatterDataPoint[];
}

export function RTvsETScatter({ data }: RTvsETScatterProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a44" />
        <XAxis dataKey="x" name="RT" tick={{ fill: "#9ca3af", fontSize: 11 }} label={{ value: "Reaction Time", position: "bottom", fill: "#6b7280", fontSize: 11 }} />
        <YAxis dataKey="y" name="ET" tick={{ fill: "#9ca3af", fontSize: 11 }} label={{ value: "ET (1320ft)", angle: -90, position: "insideLeft", fill: "#6b7280", fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: "#1e1e32", border: "1px solid #2a2a44", borderRadius: 8, color: "#e2e8f0" }} cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={data} fill="#C8102E" fillOpacity={0.6} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

interface PerformanceLineData {
  label: string;
  value: number;
}

interface PerformanceLineChartProps {
  data: PerformanceLineData[];
  dataKey?: string;
  color?: string;
  yLabel?: string;
}

export function PerformanceLineChart({ data, dataKey = "value", color = "#C8102E", yLabel }: PerformanceLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a44" />
        <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fill: "#6b7280", fontSize: 11 } : undefined} />
        <Tooltip contentStyle={{ backgroundColor: "#1e1e32", border: "1px solid #2a2a44", borderRadius: 8, color: "#e2e8f0" }} />
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 3, fill: color }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

interface MultiLineData {
  label: string;
  [key: string]: string | number | null;
}

interface MultiLineChartProps {
  data: MultiLineData[];
  lines: { key: string; label: string; color: string }[];
}

export function MultiLineChart({ data, lines }: MultiLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a44" />
        <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: "#1e1e32", border: "1px solid #2a2a44", borderRadius: 8, color: "#e2e8f0" }} />
        <Legend wrapperStyle={{ color: "#9ca3af", fontSize: 12 }} />
        {lines.map((line) => (
          <Line key={line.key} type="monotone" dataKey={line.key} name={line.label} stroke={line.color} strokeWidth={2} dot={{ r: 2 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
