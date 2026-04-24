"use client";

import { Fragment } from "react";
import type { RoundPrintPayload, RoundPrintPair, RoundPrintRun } from "@/app/api/round-print/route";

interface Props {
  data: RoundPrintPayload;
  categoryLabel: string;
  footerLabel?: string;
}

const FIRST_PAGE_PAIRS = 32;
const NEXT_PAGE_PAIRS = 38;

function fmt3(v: number | null | undefined): string {
  if (v == null) return "";
  return v.toFixed(3);
}

function fmt2(v: number | null | undefined): string {
  if (v == null) return "";
  return v.toFixed(2);
}

function fmtRT(v: number | null | undefined): string {
  if (v == null) return "";
  if (v >= 1) return v.toFixed(3);
  const abs = Math.abs(v).toFixed(3).split(".")[1];
  return (v < 0 ? "-." : ".") + abs;
}

function fmtMov(v: number | null | undefined, places = 4): string {
  if (v == null) return "";
  const abs = Math.abs(v);
  return "." + abs.toFixed(places).split(".")[1];
}

function fmtOverUnder(v: number | null | undefined): string {
  if (v == null) return "";
  return v.toString();
}

function fmtIndex(run: RoundPrintRun): string {
  if (run.index_value != null) return run.index_value.toFixed(2);
  return "";
}

function HeaderCell({ children, align = "left", w }: { children: React.ReactNode; align?: "left" | "right"; w: string }) {
  return (
    <th
      className={`px-2 py-0.5 font-bold border-b border-dashed border-gray-500 text-${align}`}
      style={{ width: w }}
    >
      {children}
    </th>
  );
}

function DataCell({ children, align = "left", mono = true }: { children?: React.ReactNode; align?: "left" | "right"; mono?: boolean }) {
  return (
    <td className={`px-2 py-[1px] text-${align} ${mono ? "font-mono" : ""} whitespace-nowrap`}>
      {children}
    </td>
  );
}

function chunkPairs(pairs: RoundPrintPair[]): RoundPrintPair[][] {
  const chunks: RoundPrintPair[][] = [];
  if (pairs.length === 0) return chunks;
  chunks.push(pairs.slice(0, FIRST_PAGE_PAIRS));
  let idx = FIRST_PAGE_PAIRS;
  while (idx < pairs.length) {
    chunks.push(pairs.slice(idx, idx + NEXT_PAGE_PAIRS));
    idx += NEXT_PAGE_PAIRS;
  }
  return chunks;
}

function Banner({ roundHeader, startTime, date, category }: { roundHeader: string; startTime: string; date: string; category: string }) {
  const bang = "!".repeat(120);
  return (
    <div>
      <div className="whitespace-pre text-[8px] leading-none overflow-hidden">{bang}</div>
      <div className="flex justify-between items-center text-[11px] my-1">
        <div className="font-bold">{roundHeader}&nbsp;&nbsp;&nbsp;{startTime}&nbsp;&nbsp;{date}</div>
        <div className="font-bold text-lg tracking-[0.2em]">{category}</div>
        <div className="text-right opacity-0 select-none">placeholder</div>
      </div>
      <div className="whitespace-pre text-[8px] leading-none overflow-hidden">{bang}</div>
      <div className="text-right text-[10px] mt-0.5 mb-2">CompuLink StarTrak&nbsp;&nbsp;&nbsp;&nbsp;#####</div>
    </div>
  );
}

function ColumnHeader() {
  return (
    <thead>
      <tr>
        <HeaderCell align="right" w="4%">#</HeaderCell>
        <HeaderCell w="6%">CLASS</HeaderCell>
        <HeaderCell w="6%">Idx/Rec</HeaderCell>
        <HeaderCell align="right" w="5%">Ov/Un</HeaderCell>
        <HeaderCell w="3%">D/I</HeaderCell>
        <HeaderCell align="right" w="5%">R/T</HeaderCell>
        <HeaderCell align="right" w="6%">60&apos;</HeaderCell>
        <HeaderCell align="right" w="6%">330</HeaderCell>
        <HeaderCell align="right" w="6%">1/8</HeaderCell>
        <HeaderCell align="right" w="6%">MPH</HeaderCell>
        <HeaderCell align="right" w="6%">1000</HeaderCell>
        <HeaderCell align="right" w="6%">ET</HeaderCell>
        <HeaderCell align="right" w="6%">MPH</HeaderCell>
        <HeaderCell align="right" w="5%">Run #</HeaderCell>
        <HeaderCell align="right" w="5%">1st</HeaderCell>
        <HeaderCell align="right" w="4%">MOV</HeaderCell>
        <HeaderCell w="5%">TIME</HeaderCell>
        <HeaderCell w="6%">Remarks</HeaderCell>
      </tr>
    </thead>
  );
}

function PairRows({ pair }: { pair: RoundPrintPair }) {
  const winnerMovAssigned = pair.pair_mov != null;
  const winnerCar = pair.winner_car;
  return (
    <>
      {pair.runs.map((run, ri) => {
        const isWinner = run.car_number != null && run.car_number === winnerCar;
        const showFirst = isWinner && winnerMovAssigned;
        const showTime = ri === 0;
        return (
          <tr key={`${pair.canonical_ts}-${run.run_number}-${ri}`} className="align-baseline">
            <DataCell align="right">{run.car_number ?? ""}</DataCell>
            <DataCell>{run.class_index ?? ""}</DataCell>
            <DataCell>{fmtIndex(run)}</DataCell>
            <DataCell align="right">{fmtOverUnder(run.over_under_thou)}</DataCell>
            <DataCell></DataCell>
            <DataCell align="right">{fmtRT(run.rt)}</DataCell>
            <DataCell align="right">{fmt3(run.ft60)}</DataCell>
            <DataCell align="right">{fmt3(run.ft330)}</DataCell>
            <DataCell align="right">{fmt3(run.ft660)}</DataCell>
            <DataCell align="right">{fmt2(run.mph_660)}</DataCell>
            <DataCell align="right">{fmt3(run.ft1000)}</DataCell>
            <DataCell align="right">{fmt3(run.ft1320)}</DataCell>
            <DataCell align="right">{fmt2(run.mph_1320)}</DataCell>
            <DataCell align="right">{String(run.run_number)}</DataCell>
            <DataCell align="right">{showFirst ? fmtMov(pair.pair_mov) : ""}</DataCell>
            <DataCell align="right">{isWinner ? fmtMov(pair.pair_mov, 2) : ""}</DataCell>
            <DataCell>{showTime ? pair.time_label : ""}</DataCell>
            <DataCell>{run.remarks}</DataCell>
          </tr>
        );
      })}
      <tr aria-hidden="true">
        <td colSpan={18} className="py-2" />
      </tr>
    </>
  );
}

export default function RoundPrintCard({ data, categoryLabel, footerLabel }: Props) {
  const {
    round_header,
    start_time_label,
    date_label,
    car_count,
    pairs,
  } = data;

  const dots = ".".repeat(30);
  const pageChunks = chunkPairs(pairs);
  const totalPages = pageChunks.length || 1;

  return (
    <div className="round-print bg-white text-black font-mono text-[11px] leading-tight p-5 mx-auto print:p-0 print:shadow-none print:m-0" style={{ width: "100%" }}>
      {pageChunks.map((chunk, pageIdx) => {
        const isFirst = pageIdx === 0;
        const isLast = pageIdx === totalPages - 1;
        return (
          <div
            key={`page-${pageIdx}`}
            className="round-print-page"
            style={{ breakAfter: isLast ? "auto" : "page", pageBreakAfter: isLast ? "auto" : "always" }}
          >
            {isFirst && (
              <Banner
                roundHeader={round_header}
                startTime={start_time_label}
                date={date_label}
                category={categoryLabel}
              />
            )}

            <table className="w-full border-collapse text-[11px] leading-tight">
              <ColumnHeader />
              <tbody>
                {chunk.map((pair, pi) => (
                  <Fragment key={`${pair.canonical_ts}-${pageIdx}-${pi}`}>
                    <PairRows pair={pair} />
                  </Fragment>
                ))}
              </tbody>
            </table>

            {isLast && (
              <div className="whitespace-pre text-center mt-3 text-[11px]">
                {dots} END of CATEGORY ... {car_count} Cars ...... {footerLabel || data.end_time_label} {dots}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
