"use client";

/**
 * Drag Strip Valley — a Silicon Valley-intro-style animated screensaver.
 *
 * A flat-design aerial valley rendered on <canvas>: parallax hills, wind
 * turbines, a blimp, parody sponsor billboards that spring in and swap
 * (the show's signature move) — all built around a working drag strip with
 * a Christmas tree, staging cars, launches, tire smoke, header flames and
 * a scoreboard. Click toggles fullscreen; the UI chrome hides when idle.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_VERSION } from "@/lib/version";

// ---------------------------------------------------------------------------
// World model
// ---------------------------------------------------------------------------

/** World is a horizontal loop this many "u" units wide (1u ≈ 1px at 900px tall). */
const WORLD_W = 7200;
const CAM_SPEED = 34; // u per second

const PALETTE = {
  skyTop: "#5fb0d4",
  skyBot: "#dbf0e2",
  sun: "#fff3c4",
  hillFar: "#b9ddb0",
  hillMid: "#9bcf8c",
  grass: "#82c065",
  grassDark: "#77b45b",
  road: "#d6c9a6",
  asphalt: "#4b4f58",
  groove: "#3e424a",
  wall: "#f4f2e8",
  stripe: "#e23d2e",
  paint: "#eceadb",
  steel: "#5c636e",
  cream: "#f6f1e3",
};

const CAR_COLORS = ["#e0453a", "#2e78d2", "#f2a03d", "#2fa87c", "#8a5cd6", "#f4d03f", "#3fb8c9", "#d4568f"];

interface BillboardContent {
  text: string;
  sub: string;
  bg: string;
  fg: string;
}

const BRANDS: BillboardContent[] = [
  { text: "PIED PIPER", sub: "PERFORMANCE PARTS", bg: "#2f9e6e", fg: "#ffffff" },
  { text: "HOOLI", sub: "NITRO DIVISION", bg: "#2b6fd4", fg: "#ffffff" },
  { text: "AVIATO", sub: "RACE FUELS", bg: "#e8564a", fg: "#ffffff" },
  { text: "HOLESHOT.IO", sub: "LAUNCH FASTER", bg: "#f4b942", fg: "#3a2c0a" },
  { text: "1320 VENTURES", sub: "ALL IN BY HALF TRACK", bg: "#7c5cd6", fg: "#ffffff" },
  { text: "STAGED CAPITAL", sub: "SHALLOW OR DEEP", bg: "#22333b", fg: "#ffd166" },
  { text: "DIAL-IN", sub: "INSURANCE CO.", bg: "#e07b39", fg: "#ffffff" },
  { text: "BREAKOUT LABS", sub: "RUNNING UNDER SINCE '87", bg: "#3bb4c1", fg: "#ffffff" },
  { text: "WALLY & SONS", sub: "FINE TROPHY POLISH", bg: "#b8433a", fg: "#ffe9c9" },
  { text: "MIDDLE-OUT", sub: "MOTORSPORTS", bg: "#4f9d69", fg: "#ffffff" },
  { text: "TREE.JS", sub: "REACTION TIME FRAMEWORK", bg: "#232a2f", fg: "#7ef29a" },
  { text: "BIG HEAD", sub: "CYLINDER HEADS", bg: "#5b8cc4", fg: "#ffffff" },
  { text: "THREE COMMA", sub: "RACING CO.", bg: "#1f2a44", fg: "#f2b134" },
  { text: "NUCLEUS", sub: "TELEMETRY BY HOOLI", bg: "#374785", fg: "#ffffff" },
  { text: "BACHMANITY", sub: "NITRO NIGHTS", bg: "#c94f7c", fg: "#ffffff" },
  { text: "SANDBAGGERS", sub: "ANONYMOUS", bg: "#8d9b6a", fg: "#2c3218" },
  { text: "DEEP STAGE", sub: "COLD BREW CO.", bg: "#4b3832", fg: "#f3e9dc" },
];

interface Billboard {
  x: number;
  w: number;
  poleH: number;
  period: number;
  phase: number;
  seq: number[]; // per-board shuffled brand order
  ptr: number; // position in seq
  curIdx: number; // brand currently shown
  lastCycle: number;
}

interface Grandstand {
  x: number;
  w: number;
  crowd: (string | null)[]; // rows * cols, null = empty seat
  cols: number;
  rows: number;
  flagColors: string[];
}

interface Tree {
  x: number;
  s: number;
  shade: number; // 0..1 blend between two greens
}

interface Turbine {
  x: number;
  s: number;
  spd: number;
  phase: number;
}

interface Trailer {
  x: number;
  w: number;
  color: string;
  awning: boolean;
}

interface World {
  billboards: Billboard[];
  usedBrands: Set<number>;
  grandstands: Grandstand[];
  towerX: number;
  waterTowerX: number;
  trees: Tree[];
  midTrees: Tree[];
  turbines: Turbine[];
  trailers: Trailer[];
  clouds: { x: number; y: number; s: number; spd: number }[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWorld(seed: number): World {
  const r = mulberry32(seed);
  const crowdColors = ["#e0453a", "#2e78d2", "#f2a03d", "#f6f1e3", "#2fa87c", "#8a5cd6", "#34404a", "#f4d03f"];

  const grandstands: Grandstand[] = [
    { x: 380, w: 560 },
    { x: 2620, w: 680 },
    { x: 4880, w: 600 },
  ].map((g) => {
    const cols = Math.floor(g.w / 16);
    const rows = 4;
    const crowd: (string | null)[] = [];
    for (let i = 0; i < cols * rows; i++) {
      crowd.push(r() < 0.82 ? crowdColors[Math.floor(r() * crowdColors.length)] : null);
    }
    const flagColors = [0, 1, 2].map(() => crowdColors[Math.floor(r() * 6)]);
    return { ...g, cols, rows, crowd, flagColors };
  });

  const billboardXs = [90, 1120, 1460, 1790, 2130, 3480, 3790, 4130, 4520, 5640, 5960, 6320, 6700, 7000];
  const usedBrands = new Set<number>();
  const billboards: Billboard[] = billboardXs.map((x) => {
    const seq = BRANDS.map((_, k) => k);
    for (let k = seq.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1));
      [seq[k], seq[j]] = [seq[j], seq[k]];
    }
    let ptr = 0;
    while (usedBrands.has(seq[ptr])) ptr++;
    usedBrands.add(seq[ptr]);
    return {
      x: x + (r() - 0.5) * 60,
      w: 170 + r() * 60,
      poleH: 46 + r() * 40,
      period: 15 + r() * 12,
      phase: r() * 25,
      seq,
      ptr,
      curIdx: seq[ptr],
      lastCycle: -1,
    };
  });

  const trees: Tree[] = [];
  for (let i = 0; i < 64; i++) trees.push({ x: r() * WORLD_W, s: 0.7 + r() * 0.8, shade: r() });
  const midTrees: Tree[] = [];
  for (let i = 0; i < 46; i++) midTrees.push({ x: r() * WORLD_W, s: 0.5 + r() * 0.6, shade: r() });

  const turbines: Turbine[] = [];
  for (let i = 0; i < 13; i++) {
    turbines.push({ x: (i / 13) * WORLD_W + r() * 260, s: 0.8 + r() * 0.5, spd: 0.9 + r() * 0.9, phase: r() * 7 });
  }

  const trailerColors = ["#f6f1e3", "#cfd6dd", "#e8dcc2", "#dbe7f2"];
  const trailers: Trailer[] = [];
  const pitZones: [number, number][] = [
    [1400, 2180],
    [3560, 4380],
    [5560, 6180],
  ];
  for (const [a, b] of pitZones) {
    let x = a;
    while (x < b) {
      const w = 70 + r() * 60;
      trailers.push({ x, w, color: trailerColors[Math.floor(r() * trailerColors.length)], awning: r() < 0.5 });
      x += w + 34 + r() * 60;
    }
  }

  const clouds = Array.from({ length: 8 }, () => ({
    x: r() * WORLD_W,
    y: 0.06 + r() * 0.3,
    s: 0.7 + r() * 1.1,
    spd: 3 + r() * 6,
  }));

  return { billboards, usedBrands, grandstands, towerX: 2320, waterTowerX: 4270, trees, midTrees, turbines, trailers, clouds };
}

// ---------------------------------------------------------------------------
// Races (Christmas tree sequence + launching cars)
// ---------------------------------------------------------------------------

type CarKind = "rail" | "door";

interface RaceLane {
  kind: CarKind;
  color: string;
  rt: number; // reaction time after green
  et: number;
  mph: number;
  accel: number;
  smokedAt: number; // last continuous smoke spawn time
}

interface Race {
  startX: number; // world x of the starting line
  t: number;
  lanes: [RaceLane, RaceLane];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
}

interface Fx {
  race: Race | null;
  nextRaceIn: number;
  particles: Particle[];
}

const TREE_PRESTAGE = [1.7, 2.05];
const TREE_STAGE = [2.75, 3.1];
const TREE_AMBER = 4.0;
const TREE_GREEN = 4.4;
const ROLL_IN_END = 1.6;

function makeRace(camX: number, viewW: number, rand: () => number): Race {
  const mkLane = (): RaceLane => {
    const kind: CarKind = rand() < 0.5 ? "rail" : "door";
    const et = kind === "rail" ? 7.3 + rand() * 1.6 : 9.4 + rand() * 2.2;
    const mph = kind === "rail" ? 165 + rand() * 30 : 118 + rand() * 32;
    return {
      kind,
      color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)],
      rt: 0.02 + rand() * 0.12,
      et,
      mph,
      accel: kind === "rail" ? 640 + rand() * 120 : 470 + rand() * 90,
      smokedAt: 0,
    };
  };
  return { startX: camX + viewW * 0.3, t: 0, lanes: [mkLane(), mkLane()] };
}

/** Car nose x (world units) for a lane at race time t. */
function laneX(race: Race, i: 0 | 1): number {
  const lane = race.lanes[i];
  const t = race.t;
  if (t < ROLL_IN_END) {
    const k = t / ROLL_IN_END;
    const ease = 1 - Math.pow(1 - k, 3);
    return race.startX - 260 * (1 - ease) - i * 24 * (1 - ease);
  }
  const launchT = TREE_GREEN + lane.rt;
  if (t < launchT) return race.startX;
  const dt = t - launchT;
  const vmax = 1350 + lane.mph * 2;
  const tRamp = vmax / lane.accel;
  if (dt < tRamp) return race.startX + 0.5 * lane.accel * dt * dt;
  return race.startX + 0.5 * lane.accel * tRamp * tRamp + vmax * (dt - tRamp);
}

// ---------------------------------------------------------------------------
// Small draw helpers
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, rad: number) {
  const r2 = Math.min(rad, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r2, y);
  ctx.arcTo(x + w, y, x + w, y + h, r2);
  ctx.arcTo(x + w, y + h, x, y + h, r2);
  ctx.arcTo(x, y + h, x, y, r2);
  ctx.arcTo(x, y, x + w, y, r2);
  ctx.closePath();
}

function easeOutBack(x: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Pop-in/out scale for a repeating billboard cycle. */
function popScale(t: number, period: number, phase: number): { s: number; cycle: number } {
  const local = (t + phase) % period;
  const cycle = Math.floor((t + phase) / period);
  const IN = 0.6;
  const OUT = 0.35;
  if (local < IN) return { s: Math.max(0, easeOutBack(local / IN)), cycle };
  if (local > period - OUT) return { s: Math.max(0, (period - local) / OUT), cycle };
  return { s: 1, cycle };
}

function mixGreen(shade: number, a: string, b: string) {
  return shade < 0.5 ? a : b;
}

// ---------------------------------------------------------------------------
// Scene layers
// ---------------------------------------------------------------------------

interface Frame {
  ctx: Ctx;
  W: number;
  H: number;
  u: number;
  t: number;
  camX: number;
  horizon: number;
  trackTop: number;
  trackBot: number;
  wallH: number;
}

/** Screen x for a world x on a parallax plane, or null when off-screen. */
function screenX(f: Frame, wx: number, p: number, margin: number): number | null {
  const d = (((wx - f.camX * p) % WORLD_W) + WORLD_W) % WORLD_W;
  const sx = d * f.u;
  if (sx > -margin && sx < f.W + margin) return sx;
  const sx2 = (d - WORLD_W) * f.u;
  if (sx2 > -margin && sx2 < f.W + margin) return sx2;
  return null;
}

const HILL_FAR = { p: 0.12, base: 0.115, amp: 0.055 };
const HILL_MID = { p: 0.3, base: 0.05, amp: 0.038 };

function hillShape(wx: number, a: number, b: number, c: number) {
  return Math.sin(wx * 0.0016 + a) * 0.55 + Math.sin(wx * 0.00063 + b) * 0.35 + Math.sin(wx * 0.0034 + c) * 0.1;
}

function drawSkyAndHills(f: Frame, world: World) {
  const { ctx, W, H, u, t, camX, horizon } = f;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, PALETTE.skyTop);
  sky.addColorStop(1, PALETTE.skyBot);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon + 2);

  // Sun with a soft halo
  const sunX = W * 0.16;
  const sunY = H * 0.14;
  const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, H * 0.16);
  halo.addColorStop(0, "rgba(255,243,196,0.85)");
  halo.addColorStop(1, "rgba(255,243,196,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(sunX - H * 0.16, sunY - H * 0.16, H * 0.32, H * 0.32);
  ctx.fillStyle = PALETTE.sun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, H * 0.045, 0, Math.PI * 2);
  ctx.fill();

  // Clouds
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  for (const c of world.clouds) {
    const sx = screenX(f, c.x + t * c.spd, 0.08, 220);
    if (sx === null) continue;
    const cy = c.y * H;
    const s = c.s * u;
    ctx.beginPath();
    ctx.arc(sx, cy, 22 * s, 0, Math.PI * 2);
    ctx.arc(sx + 26 * s, cy - 8 * s, 17 * s, 0, Math.PI * 2);
    ctx.arc(sx - 27 * s, cy - 4 * s, 15 * s, 0, Math.PI * 2);
    ctx.arc(sx + 5 * s, cy - 15 * s, 15 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // A few gliding birds
  ctx.strokeStyle = "rgba(50,68,78,0.65)";
  ctx.lineWidth = Math.max(1.4, 1.8 * u);
  ctx.lineCap = "round";
  for (let i = 0; i < 4; i++) {
    const sx = screenX(f, 900 + i * 1900 + t * (26 + i * 5), 0.16, 60);
    if (sx === null) continue;
    const by = H * (0.2 + 0.07 * Math.sin(i * 2.4)) + Math.sin(t * 1.1 + i * 2) * H * 0.012;
    const flap = Math.sin(t * 6 + i * 1.9) * 3 * u;
    ctx.beginPath();
    ctx.moveTo(sx - 7 * u, by - flap);
    ctx.quadraticCurveTo(sx - 2 * u, by + 2 * u, sx, by);
    ctx.quadraticCurveTo(sx + 2 * u, by + 2 * u, sx + 7 * u, by - flap);
    ctx.stroke();
  }

  drawBlimp(f);

  // Two ranges of rolling hills
  for (const [layer, color] of [
    [HILL_FAR, PALETTE.hillFar],
    [HILL_MID, PALETTE.hillMid],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-4, horizon + 2);
    for (let px = -4; px <= W + 4; px += 18) {
      const wx = px / u + camX * layer.p;
      const y = horizon - H * layer.base - hillShape(wx, 1.3, 4.1, 2.2) * H * layer.amp;
      ctx.lineTo(px, y);
    }
    ctx.lineTo(W + 4, horizon + 2);
    ctx.closePath();
    ctx.fill();
  }

  // Wind turbines standing on the mid range
  for (const tb of world.turbines) {
    const sx = screenX(f, tb.x, HILL_MID.p, 60);
    if (sx === null) continue;
    const gy = horizon - H * HILL_MID.base - hillShape(tb.x, 1.3, 4.1, 2.2) * H * HILL_MID.amp;
    const s = tb.s * u;
    const hubY = gy - 44 * s;
    ctx.strokeStyle = "#e9efe6";
    ctx.lineWidth = 2.6 * s;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx, gy);
    ctx.lineTo(sx, hubY);
    ctx.stroke();
    const ang = t * tb.spd + tb.phase;
    ctx.lineWidth = 2.2 * s;
    for (let b = 0; b < 3; b++) {
      const a = ang + (b * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(sx, hubY);
      ctx.lineTo(sx + Math.cos(a) * 17 * s, hubY + Math.sin(a) * 17 * s);
      ctx.stroke();
    }
    ctx.fillStyle = "#f6f6f0";
    ctx.beginPath();
    ctx.arc(sx, hubY, 2.4 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBlimp(f: Frame) {
  const { ctx, H, u, t } = f;
  const sx = screenX(f, 600 + t * 14, 0.2, 260);
  if (sx === null) return;
  const y = H * 0.13 + Math.sin(t * 0.4) * H * 0.008;
  const s = u;
  ctx.save();
  ctx.translate(sx, y);
  ctx.fillStyle = "#f2efe4";
  ctx.beginPath();
  ctx.ellipse(0, 0, 62 * s, 20 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.stripe;
  ctx.beginPath();
  ctx.ellipse(0, 8 * s, 60 * s, 10 * s, 0, 0, Math.PI);
  ctx.fill();
  // tail fins + gondola
  ctx.fillStyle = "#d8d4c4";
  ctx.beginPath();
  ctx.moveTo(-58 * s, -4 * s);
  ctx.lineTo(-78 * s, -18 * s);
  ctx.lineTo(-60 * s, 4 * s);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-58 * s, 4 * s);
  ctx.lineTo(-76 * s, 16 * s);
  ctx.lineTo(-56 * s, 10 * s);
  ctx.closePath();
  ctx.fill();
  rr(ctx, -12 * s, 18 * s, 24 * s, 8 * s, 3 * s);
  ctx.fillStyle = "#3a4149";
  ctx.fill();
  ctx.fillStyle = "#3a4149";
  ctx.font = `800 ${13 * s}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("TIMING DATA", 0, -1 * s);
  ctx.restore();
}

function drawGrassAndRoad(f: Frame, world: World) {
  const { ctx, W, H, u, horizon, trackTop } = f;
  ctx.fillStyle = PALETTE.grass;
  ctx.fillRect(0, horizon, W, trackTop - horizon);
  ctx.fillStyle = PALETTE.grassDark;
  ctx.fillRect(0, horizon + (trackTop - horizon) * 0.55, W, (trackTop - horizon) * 0.45);

  // Lighter mowed patches break up the flat green
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  for (let i = 0; i < 9; i++) {
    const px = screenX(f, i * 810 + (i % 3) * 140, 0.9, 500);
    if (px === null) continue;
    const pw = (260 + (i % 4) * 120) * u;
    const py = horizon + (trackTop - horizon) * (0.08 + (i % 3) * 0.14);
    rr(ctx, px, py, pw, (trackTop - horizon) * 0.16, 8 * u);
    ctx.fill();
  }

  // Access road the pit rigs park along
  const roadY = horizon + (trackTop - horizon) * 0.42;
  ctx.fillStyle = PALETTE.road;
  ctx.fillRect(0, roadY, W, H * 0.016);

  // Distant tree line just below the horizon
  for (const tr of world.midTrees) {
    const sx = screenX(f, tr.x, 0.55, 40);
    if (sx === null) continue;
    drawTree(ctx, sx, horizon + H * 0.012, tr.s * u * 0.7, mixGreen(tr.shade, "#5e9e54", "#54924c"));
  }
}

function drawTree(ctx: Ctx, x: number, groundY: number, s: number, color: string) {
  ctx.fillStyle = "#8a6b4d";
  ctx.fillRect(x - 2 * s, groundY - 16 * s, 4 * s, 16 * s);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, groundY - 26 * s, 13 * s, 0, Math.PI * 2);
  ctx.arc(x - 9 * s, groundY - 19 * s, 9 * s, 0, Math.PI * 2);
  ctx.arc(x + 9 * s, groundY - 19 * s, 9 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawTrailer(f: Frame, tr: Trailer) {
  const { ctx, H, u, horizon, trackTop } = f;
  const sx = screenX(f, tr.x, 1, 260);
  if (sx === null) return;
  const gy = horizon + (trackTop - horizon) * 0.42 + H * 0.016;
  const w = tr.w * u;
  const h = Math.min(30 * u, H * 0.035);
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.beginPath();
  ctx.ellipse(sx + w / 2, gy + 2 * u, w * 0.55, 3.4 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  rr(ctx, sx, gy - h, w, h, 3 * u);
  ctx.fillStyle = tr.color;
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(sx, gy - h, w, 3 * u);
  ctx.fillStyle = "#3a4149";
  ctx.beginPath();
  ctx.arc(sx + w * 0.22, gy, 3.4 * u, 0, Math.PI * 2);
  ctx.arc(sx + w * 0.78, gy, 3.4 * u, 0, Math.PI * 2);
  ctx.fill();
  if (tr.awning) {
    ctx.fillStyle = PALETTE.stripe;
    ctx.beginPath();
    ctx.moveTo(sx + w, gy - h);
    ctx.lineTo(sx + w + w * 0.3, gy - h * 0.55);
    ctx.lineTo(sx + w, gy - h * 0.55);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBillboard(f: Frame, bb: Billboard, usedBrands: Set<number>) {
  const { ctx, H, u, t, trackTop, wallH } = f;
  const { s, cycle } = popScale(t, bb.period, bb.phase);

  // Swap brands between cycles (scale is ~0 there), never duplicating a brand
  // that another board is currently showing.
  if (bb.lastCycle === -1) {
    bb.lastCycle = cycle;
  } else if (cycle !== bb.lastCycle) {
    bb.lastCycle = cycle;
    usedBrands.delete(bb.curIdx);
    do {
      bb.ptr = (bb.ptr + 1) % bb.seq.length;
    } while (usedBrands.has(bb.seq[bb.ptr]));
    bb.curIdx = bb.seq[bb.ptr];
    usedBrands.add(bb.curIdx);
  }

  const sx = screenX(f, bb.x, 1, 300);
  if (sx === null) return;
  if (s <= 0.01) return;
  const content = BRANDS[bb.curIdx];

  const gy = trackTop - wallH - H * 0.004;
  const w = bb.w * u;
  const h = w * 0.42;
  const poleH = bb.poleH * u;

  ctx.save();
  ctx.translate(sx, gy);
  ctx.scale(s, s);

  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.beginPath();
  ctx.ellipse(0, 2 * u, w * 0.4, 4 * u, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = PALETTE.steel;
  ctx.fillRect(-w * 0.18 - 2.5 * u, -poleH, 5 * u, poleH);
  ctx.fillRect(w * 0.18 - 2.5 * u, -poleH, 5 * u, poleH);

  const bx = -w / 2;
  const by = -poleH - h;
  rr(ctx, bx - 3 * u, by - 3 * u, w + 6 * u, h + 6 * u, 6 * u);
  ctx.fillStyle = "#fbfaf3";
  ctx.fill();
  rr(ctx, bx, by, w, h, 4 * u);
  ctx.fillStyle = content.bg;
  ctx.fill();

  ctx.fillStyle = content.fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${h * 0.26}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(content.text, 0, by + h * 0.42, w * 0.9);
  ctx.globalAlpha = 0.85;
  ctx.font = `600 ${h * 0.13}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(content.sub, 0, by + h * 0.72, w * 0.88);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawGrandstand(f: Frame, g: Grandstand) {
  const { ctx, H, u, t, trackTop, wallH } = f;
  const sx = screenX(f, g.x, 1, (g.w + 100) * u);
  if (sx === null) return;
  const gy = trackTop - wallH - H * 0.002;
  const w = g.w * u;
  const gh = H * 0.15;
  const rowH = gh * 0.155;

  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.fillRect(sx - 4 * u, gy - 2 * u, w + 8 * u, 4 * u);

  // Tiered rows, stepping back and up
  for (let rIdx = 0; rIdx < g.rows; rIdx++) {
    const y = gy - rowH * (rIdx + 1);
    const inset = rIdx * 3 * u;
    ctx.fillStyle = rIdx % 2 ? "#c9cfd6" : "#d8dde3";
    ctx.fillRect(sx + inset, y, w - inset * 2, rowH);
  }
  // Crowd
  const seatW = (w - g.rows * 3 * u * 2) / g.cols;
  for (let rIdx = 0; rIdx < g.rows; rIdx++) {
    const y = gy - rowH * (rIdx + 1) + rowH * 0.32;
    const inset = rIdx * 3 * u;
    for (let cIdx = 0; cIdx < g.cols; cIdx++) {
      const color = g.crowd[rIdx * g.cols + cIdx];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx + inset + seatW * (cIdx + 0.5), y, Math.min(3.2 * u, seatW * 0.32), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Roof + supports
  const roofY = gy - rowH * g.rows - H * 0.014;
  ctx.fillStyle = PALETTE.steel;
  for (const fr of [0.06, 0.5, 0.94]) {
    ctx.fillRect(sx + w * fr - 2.2 * u, roofY, 4.4 * u, gy - rowH * (g.rows - 1) - roofY);
  }
  rr(ctx, sx - 6 * u, roofY - 8 * u, w + 12 * u, 10 * u, 4 * u);
  ctx.fillStyle = PALETTE.cream;
  ctx.fill();
  ctx.fillStyle = PALETTE.stripe;
  ctx.fillRect(sx - 6 * u, roofY + 2 * u, w + 12 * u, 2.4 * u);

  // Waving roof flags
  for (let i = 0; i < 3; i++) {
    const fx = sx + w * (0.18 + i * 0.32);
    const fy = roofY - 7 * u;
    ctx.strokeStyle = PALETTE.steel;
    ctx.lineWidth = 1.4 * u;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx, fy - 13 * u);
    ctx.stroke();
    const wave = Math.sin(t * 3 + i * 1.7) * 3 * u;
    ctx.fillStyle = g.flagColors[i];
    ctx.beginPath();
    ctx.moveTo(fx, fy - 13 * u);
    ctx.quadraticCurveTo(fx + 6 * u, fy - 14 * u + wave * 0.5, fx + 12 * u, fy - 11 * u + wave);
    ctx.lineTo(fx, fy - 8 * u);
    ctx.closePath();
    ctx.fill();
  }
}

/** Drawn in a translated context: the caller positions x, we draw around x=0. */
function drawTimingTower(f: Frame) {
  const { ctx, H, u, t, trackTop, wallH } = f;
  const gy = trackTop - wallH - H * 0.002;
  const w = 74 * u;
  const h = H * 0.27;
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.beginPath();
  ctx.ellipse(0, gy, w * 0.7, 4 * u, 0, 0, Math.PI * 2);
  ctx.fill();

  rr(ctx, -w / 2, gy - h, w, h, 5 * u);
  ctx.fillStyle = PALETTE.cream;
  ctx.fill();
  ctx.fillStyle = PALETTE.stripe;
  ctx.fillRect(-w / 2, gy - h + h * 0.16, w, 3 * u);

  // Checkered band
  const sq = 5 * u;
  for (let i = 0; i < Math.floor(w / sq); i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? "#2c3238" : "#f4f2e8";
      ctx.fillRect(-w / 2 + i * sq, gy - h * 0.32 + j * sq, sq, sq);
    }
  }

  // Windows
  ctx.fillStyle = "#9fc4d8";
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 2; i++) {
      rr(ctx, -w * 0.32 + i * w * 0.36, gy - h * 0.82 + j * h * 0.13, w * 0.28, h * 0.09, 2 * u);
      ctx.fill();
    }
  }

  ctx.fillStyle = "#3a4149";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${8.5 * u}px system-ui, sans-serif`;
  ctx.fillText("TIMING DATA", 0, gy - h + h * 0.09, w * 0.9);

  // Antenna with a blinking beacon
  ctx.strokeStyle = PALETTE.steel;
  ctx.lineWidth = 1.8 * u;
  ctx.beginPath();
  ctx.moveTo(0, gy - h);
  ctx.lineTo(0, gy - h - 22 * u);
  ctx.stroke();
  const blink = (Math.sin(t * 3.2) + 1) / 2;
  ctx.fillStyle = `rgba(255,65,54,${0.35 + blink * 0.65})`;
  ctx.beginPath();
  ctx.arc(0, gy - h - 24 * u, (2.4 + blink * 1.2) * u, 0, Math.PI * 2);
  ctx.fill();
}

function drawWaterTower(f: Frame) {
  const { ctx, H, u, trackTop, wallH } = f;
  const gy = trackTop - wallH - H * 0.002;
  const h = H * 0.17;
  const rw = 30 * u;
  ctx.strokeStyle = PALETTE.steel;
  ctx.lineWidth = 2.4 * u;
  ctx.beginPath();
  ctx.moveTo(-rw * 0.7, gy);
  ctx.lineTo(-rw * 0.4, gy - h * 0.62);
  ctx.moveTo(rw * 0.7, gy);
  ctx.lineTo(rw * 0.4, gy - h * 0.62);
  ctx.moveTo(-rw * 0.6, gy - h * 0.3);
  ctx.lineTo(rw * 0.6, gy - h * 0.3);
  ctx.stroke();
  ctx.fillStyle = PALETTE.cream;
  ctx.beginPath();
  ctx.ellipse(0, gy - h * 0.78, rw, h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-rw, gy - h * 0.78);
  ctx.quadraticCurveTo(0, gy - h * 1.12, rw, gy - h * 0.78);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.stripe;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${h * 0.16}px system-ui, sans-serif`;
  ctx.fillText("1320", 0, gy - h * 0.78);
}

const WALL_MARKERS = ["60 FT", "330 FT", "1/8 MI", "1000 FT", "1/4 MI"];

function drawTrack(f: Frame) {
  const { ctx, W, H, u, camX, trackTop, trackBot, wallH } = f;
  const bandH = trackBot - trackTop;

  // Far retaining wall with distance markers
  ctx.fillStyle = PALETTE.wall;
  ctx.fillRect(0, trackTop - wallH, W, wallH);
  ctx.fillStyle = PALETTE.stripe;
  ctx.fillRect(0, trackTop - wallH, W, Math.max(2, wallH * 0.2));
  const markerGap = 300;
  const first = Math.floor(camX / markerGap) * markerGap;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let m = first - markerGap; m < camX + W / u + markerGap; m += markerGap) {
    const sx = (m - camX) * u;
    if (sx < -80 || sx > W + 80) continue;
    const label = WALL_MARKERS[((Math.round(m / markerGap) % WALL_MARKERS.length) + WALL_MARKERS.length) % WALL_MARKERS.length];
    ctx.fillStyle = "#3a4149";
    ctx.font = `800 ${wallH * 0.5}px system-ui, sans-serif`;
    ctx.fillText(label, sx, trackTop - wallH * 0.38);
  }

  // Asphalt
  ctx.fillStyle = PALETTE.asphalt;
  ctx.fillRect(0, trackTop, W, bandH);

  // Rubbered-in racing grooves
  ctx.fillStyle = PALETTE.groove;
  ctx.fillRect(0, trackTop + bandH * 0.22, W, bandH * 0.17);
  ctx.fillRect(0, trackTop + bandH * 0.63, W, bandH * 0.17);

  // Edge lines + dashed centerline (scrolls with the world)
  ctx.fillStyle = PALETTE.paint;
  ctx.fillRect(0, trackTop + 2, W, Math.max(2, H * 0.003));
  ctx.fillRect(0, trackBot - 2 - Math.max(2, H * 0.003), W, Math.max(2, H * 0.003));
  const dashW = 46 * u;
  const gapW = 34 * u;
  const cycle = dashW + gapW;
  const off = ((camX * u) % cycle + cycle) % cycle;
  const midY = trackTop + bandH / 2;
  for (let x = -off; x < W; x += cycle) {
    ctx.fillRect(x, midY - Math.max(1.5, H * 0.0022), dashW, Math.max(3, H * 0.0044));
  }

  // Near-side guardrail
  ctx.fillStyle = "#aeb4bb";
  ctx.fillRect(0, trackBot, W, H * 0.014);
  ctx.fillStyle = "#8f959c";
  ctx.fillRect(0, trackBot + H * 0.014, W, H * 0.004);
}

// --- Christmas tree ---------------------------------------------------------

function drawChristmasTree(f: Frame, race: Race) {
  const { ctx, H, u, trackTop, trackBot } = f;
  const sx = (race.startX - f.camX) * u;
  if (sx < -100 || sx > f.W + 100) return;
  const bandH = trackBot - trackTop;

  // Starting line across the track
  ctx.fillStyle = PALETTE.paint;
  ctx.fillRect(sx - 1.5 * u, trackTop + 3, 3 * u, bandH - 6);

  const poleTop = trackTop - H * 0.115;
  const boardW = 17 * u;
  const boardH = H * 0.085;
  const cx = sx - 26 * u;

  ctx.strokeStyle = "#2c3238";
  ctx.lineWidth = 2.2 * u;
  ctx.beginPath();
  ctx.moveTo(cx, trackTop + bandH * 0.5);
  ctx.lineTo(cx, poleTop + boardH);
  ctx.stroke();
  rr(ctx, cx - boardW / 2, poleTop, boardW, boardH, 3 * u);
  ctx.fillStyle = "#22262b";
  ctx.fill();

  const rt = race.t;
  const bulb = (col: 0 | 1, row: number, r: number, on: boolean, color: string, glow: boolean) => {
    const bx = cx + (col === 0 ? -boardW * 0.22 : boardW * 0.22);
    const by = poleTop + boardH * (0.09 + row * 0.135);
    if (on && glow) {
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, r * 3.2);
      g.addColorStop(0, color + "aa");
      g.addColorStop(1, color + "00");
      ctx.fillStyle = g;
      ctx.fillRect(bx - r * 3.2, by - r * 3.2, r * 6.4, r * 6.4);
    }
    ctx.fillStyle = on ? color : "#3a3f45";
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  };

  const amberOn = rt >= TREE_AMBER && rt < TREE_GREEN;
  const greenFlash = rt >= TREE_GREEN && rt < TREE_GREEN + 2.2;
  for (const col of [0, 1] as const) {
    bulb(col, 0, 1.7 * u, rt >= TREE_PRESTAGE[col], "#ffd166", false);
    bulb(col, 1, 1.7 * u, rt >= TREE_STAGE[col], "#ffd166", false);
    for (let a = 0; a < 3; a++) bulb(col, 2 + a, 2.3 * u, amberOn, "#ffb02e", true);
    bulb(col, 5, 2.3 * u, greenFlash, "#35d461", true);
    bulb(col, 6, 2.3 * u, false, "#ff4136", false);
  }
}

// --- Cars --------------------------------------------------------------------

function drawRail(ctx: Ctx, s: number, color: string) {
  // Local space: rear axle at (0,0), nose points +x
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(46 * s, 2 * s, 62 * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rear wing
  ctx.fillStyle = "#2c3238";
  ctx.fillRect(-6 * s, -34 * s, 2.6 * s, 18 * s);
  ctx.fillRect(-2 * s, -34 * s, 2.6 * s, 14 * s);
  ctx.fillStyle = color;
  rr(ctx, -16 * s, -40 * s, 26 * s, 6 * s, 2 * s);
  ctx.fill();

  // Body: long tapered rail
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-10 * s, -6 * s);
  ctx.lineTo(14 * s, -17 * s);
  ctx.lineTo(34 * s, -14 * s);
  ctx.lineTo(108 * s, -7 * s);
  ctx.lineTo(116 * s, -3 * s);
  ctx.lineTo(112 * s, 0);
  ctx.lineTo(-10 * s, 0);
  ctx.closePath();
  ctx.fill();

  // Engine + injector hat
  ctx.fillStyle = "#3a4149";
  rr(ctx, 2 * s, -20 * s, 14 * s, 12 * s, 2 * s);
  ctx.fill();
  rr(ctx, 5 * s, -26 * s, 8 * s, 7 * s, 2 * s);
  ctx.fill();
  // Cockpit
  ctx.fillStyle = "#22262b";
  ctx.beginPath();
  ctx.arc(28 * s, -13 * s, 5 * s, Math.PI, 0);
  ctx.fill();

  // Wheels
  ctx.fillStyle = "#22262b";
  ctx.beginPath();
  ctx.arc(0, -1 * s, 15 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a525b";
  ctx.beginPath();
  ctx.arc(0, -1 * s, 6.5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#22262b";
  ctx.beginPath();
  ctx.arc(98 * s, 1 * s, 5.5 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawDoorCar(ctx: Ctx, s: number, color: string) {
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(38 * s, 2 * s, 48 * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Spoiler
  ctx.fillStyle = "#2c3238";
  ctx.fillRect(-14 * s, -26 * s, 3 * s, 8 * s);
  ctx.fillStyle = color;
  rr(ctx, -22 * s, -29 * s, 18 * s, 4.5 * s, 2 * s);
  ctx.fill();

  // Body silhouette
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-16 * s, -4 * s);
  ctx.lineTo(-14 * s, -20 * s);
  ctx.quadraticCurveTo(4 * s, -30 * s, 26 * s, -27 * s);
  ctx.quadraticCurveTo(44 * s, -25 * s, 56 * s, -16 * s);
  ctx.lineTo(80 * s, -12 * s);
  ctx.quadraticCurveTo(88 * s, -10 * s, 87 * s, -4 * s);
  ctx.lineTo(-16 * s, -4 * s);
  ctx.closePath();
  ctx.fill();

  // Windows
  ctx.fillStyle = "#22303a";
  ctx.beginPath();
  ctx.moveTo(2 * s, -26 * s);
  ctx.quadraticCurveTo(18 * s, -28 * s, 30 * s, -24 * s);
  ctx.lineTo(40 * s, -17 * s);
  ctx.lineTo(6 * s, -17 * s);
  ctx.closePath();
  ctx.fill();

  // Wheels
  ctx.fillStyle = "#22262b";
  ctx.beginPath();
  ctx.arc(0, -1 * s, 12.5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(64 * s, 0, 9 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a525b";
  ctx.beginPath();
  ctx.arc(0, -1 * s, 5.5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(64 * s, 0, 3.8 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawRaceCars(f: Frame, fx: Fx) {
  const race = fx.race;
  if (!race) return;
  const { ctx, u, t, trackTop, trackBot } = f;
  const bandH = trackBot - trackTop;
  const laneY = [trackTop + bandH * 0.36, trackTop + bandH * 0.79];
  const laneScale = [0.86, 1.05];

  for (const i of [0, 1] as const) {
    const lane = race.lanes[i];
    const noseX = laneX(race, i);
    const sx = (noseX - f.camX) * u;
    if (sx < -300 || sx > f.W + 500) continue;
    const s = laneScale[i] * u * (bandH / 160);
    const launchT = TREE_GREEN + lane.rt;
    const sinceLaunch = race.t - launchT;

    ctx.save();
    // Position rear axle: nose is ~116s (rail) / 87s (door) ahead of the axle
    const noseLen = lane.kind === "rail" ? 116 : 87;
    ctx.translate(sx - noseLen * s, laneY[i]);
    if (sinceLaunch > 0 && sinceLaunch < 0.65) {
      const k = Math.sin((sinceLaunch / 0.65) * Math.PI);
      ctx.rotate(-k * 0.07);
    }
    if (lane.kind === "rail") drawRail(ctx, s, lane.color);
    else drawDoorCar(ctx, s, lane.color);

    // Header flames during the launch
    if (sinceLaunch > 0 && sinceLaunch < 1.3) {
      const flick = 0.6 + 0.4 * Math.sin(t * 42 + i * 3);
      const fxX = lane.kind === "rail" ? 9 * s : 20 * s;
      const fxY = lane.kind === "rail" ? -27 * s : -22 * s;
      ctx.fillStyle = "#ff8a2a";
      ctx.beginPath();
      ctx.moveTo(fxX - 3 * s, fxY);
      ctx.lineTo(fxX, fxY - 12 * s * flick);
      ctx.lineTo(fxX + 3 * s, fxY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffd84d";
      ctx.beginPath();
      ctx.moveTo(fxX - 1.6 * s, fxY);
      ctx.lineTo(fxX, fxY - 7 * s * flick);
      ctx.lineTo(fxX + 1.6 * s, fxY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Speed streaks once the car is really moving
    if (sinceLaunch > 0.7) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = Math.max(1.5, 2 * u);
      ctx.lineCap = "round";
      for (let k = 0; k < 3; k++) {
        const ly = laneY[i] - (6 + k * 7) * u * laneScale[i];
        ctx.beginPath();
        ctx.moveTo(sx - (150 + k * 40) * u * 0.6, ly);
        ctx.lineTo(sx - (220 + k * 55) * u * 0.6, ly);
        ctx.stroke();
      }
    }
  }
}

function drawScoreboard(f: Frame, race: Race) {
  const { ctx, H, u, trackTop, wallH } = f;
  if (race.t < TREE_GREEN + 1.8 || race.t > TREE_GREEN + 6.5) return;
  const sx = (race.startX + 430 - f.camX) * u;
  if (sx < -200 || sx > f.W + 200) return;

  const w = 208 * u;
  const h = 52 * u;
  const y = trackTop - wallH - H * 0.005 - h - 26 * u;
  ctx.fillStyle = PALETTE.steel;
  ctx.fillRect(sx - 2 * u, y + h, 4 * u, 26 * u);
  rr(ctx, sx - w / 2, y, w, h, 4 * u);
  ctx.fillStyle = "#181c20";
  ctx.fill();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${13 * u}px ui-monospace, Menlo, monospace`;
  for (const i of [0, 1] as const) {
    const lane = race.lanes[i];
    const ly = y + h * (i === 0 ? 0.3 : 0.72);
    ctx.fillStyle = "#8f959c";
    ctx.fillText(i === 0 ? "L" : "R", sx - w / 2 + 8 * u, ly);
    ctx.fillStyle = "#ffd84d";
    ctx.fillText(`${lane.rt.toFixed(3)}  ${lane.et.toFixed(3)} @ ${lane.mph.toFixed(2)}`, sx - w / 2 + 24 * u, ly);
  }
}

// --- Smoke -------------------------------------------------------------------

function updateAndDrawParticles(f: Frame, fx: Fx, dt: number) {
  const { ctx, u } = f;
  const list = fx.particles;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.age += dt;
    if (p.age >= p.life) {
      list.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.r += 26 * dt;
    const a = (1 - p.age / p.life) * 0.42;
    ctx.fillStyle = `rgba(242,242,238,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc((p.x - f.camX) * u, p.y, p.r * u, 0, Math.PI * 2);
    ctx.fill();
  }
}

function spawnLaunchSmoke(f: Frame, fx: Fx, rand: () => number) {
  const race = fx.race;
  if (!race) return;
  const { trackTop, trackBot } = f;
  const bandH = trackBot - trackTop;
  const laneY = [trackTop + bandH * 0.36, trackTop + bandH * 0.79];
  for (const i of [0, 1] as const) {
    const lane = race.lanes[i];
    const launchT = TREE_GREEN + lane.rt;
    const since = race.t - launchT;
    if (since < 0 || since > 0.8) continue;
    if (race.t - lane.smokedAt < 0.03) continue;
    lane.smokedAt = race.t;
    const rearX = laneX(race, i) - (lane.kind === "rail" ? 116 : 87);
    for (let n = 0; n < 3; n++) {
      fx.particles.push({
        x: rearX - rand() * 26,
        y: laneY[i] - rand() * 8,
        vx: -30 - rand() * 60,
        vy: -14 - rand() * 26,
        r: 4 + rand() * 7,
        age: 0,
        life: 0.9 + rand() * 0.9,
      });
    }
  }
}

// --- Foreground + finishing touches -------------------------------------------

function drawForeground(f: Frame) {
  const { ctx, W, H, u, camX, trackBot } = f;
  const topY = trackBot + H * 0.018;
  ctx.fillStyle = PALETTE.grassDark;
  ctx.fillRect(0, topY, W, H - topY);

  // Spectator fence, slightly faster parallax for depth
  const p = 1.3;
  const postTop = topY + H * 0.006;
  const postBot = topY + H * 0.042;
  ctx.strokeStyle = "rgba(70,80,88,0.5)";
  ctx.lineWidth = Math.max(1.5, 2 * u);
  const gap = 110;
  const first = Math.floor((camX * p) / gap) * gap;
  for (let m = first - gap; m < camX * p + W / u + gap; m += gap) {
    const sx = (m - camX * p) * u;
    ctx.beginPath();
    ctx.moveTo(sx, postTop);
    ctx.lineTo(sx, postBot);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, postTop + 3 * u);
  ctx.lineTo(W, postTop + 3 * u);
  ctx.moveTo(0, postBot - 4 * u);
  ctx.lineTo(W, postBot - 4 * u);
  ctx.stroke();

  // Bushes in front of the fence line
  const bGap = 190;
  const bFirst = Math.floor((camX * p) / bGap) * bGap;
  for (let m = bFirst - bGap; m < camX * p + W / u + bGap; m += bGap) {
    const sx = (m - camX * p) * u + Math.sin(m * 0.71) * 40 * u;
    const jitter = Math.abs(Math.sin(m * 12.9898) % 1);
    const s = (1.1 + jitter * 0.9) * u;
    const by = postBot + H * 0.02 + jitter * H * 0.015;
    ctx.fillStyle = jitter > 0.5 ? "#5e9e54" : "#549240";
    ctx.beginPath();
    ctx.arc(sx, by, 13 * s, 0, Math.PI * 2);
    ctx.arc(sx + 11 * s, by + 3 * s, 9 * s, 0, Math.PI * 2);
    ctx.arc(sx - 11 * s, by + 3 * s, 9 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawVignette(f: Frame) {
  const { ctx, W, H } = f;
  const g = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.45, W / 2, H * 0.5, Math.max(W, H) * 0.75);
  g.addColorStop(0, "rgba(10,15,20,0)");
  g.addColorStop(1, "rgba(10,15,20,0.24)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ScreensaverPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [uiVisible, setUiVisible] = useState(true);
  const [clock, setClock] = useState("");

  // Idle detection: hide the cursor and chrome after a few quiet seconds
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const poke = () => {
      setUiVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setUiVisible(false), 3200);
    };
    poke();
    window.addEventListener("mousemove", poke);
    window.addEventListener("touchstart", poke);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", poke);
      window.removeEventListener("touchstart", poke);
    };
  }, []);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timeScale = reduced ? 0.35 : 1;

    let W = 0;
    let H = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const world = makeWorld(0x1320);
    const rand = mulberry32(Date.now() >>> 0);
    const fx: Fx = { race: null, nextRaceIn: 2.5, particles: [] };

    let raf = 0;
    let last = performance.now();
    let t = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.05) * timeScale;
      last = now;
      t += dt;
      const camX = t * CAM_SPEED;
      const u = H / 900;

      const f: Frame = {
        ctx,
        W,
        H,
        u,
        t,
        camX,
        horizon: H * 0.56,
        trackTop: H * 0.7,
        trackBot: H * 0.895,
        wallH: Math.max(9, H * 0.024),
      };

      // Race lifecycle
      if (fx.race) {
        fx.race.t += dt;
        spawnLaunchSmoke(f, fx, rand);
        const gone =
          fx.race.t > 12 ||
          (laneX(fx.race, 0) - camX > W / u + 400 && laneX(fx.race, 1) - camX > W / u + 400 && fx.race.t > TREE_GREEN + 3);
        if (gone && fx.race.t > TREE_GREEN + 6.6) {
          fx.race = null;
          fx.nextRaceIn = 4 + rand() * 5;
        }
      } else {
        fx.nextRaceIn -= dt;
        if (fx.nextRaceIn <= 0) fx.race = makeRace(camX, W / u, rand);
      }

      // --- Render ---
      drawSkyAndHills(f, world);
      drawGrassAndRoad(f, world);

      for (const tr of world.trees) {
        const sx = screenX(f, tr.x, 1, 80);
        if (sx === null) continue;
        drawTree(ctx, sx, f.trackTop - f.wallH - H * 0.004, tr.s * u, mixGreen(tr.shade, "#4f9d45", "#5aa84f"));
      }
      for (const tr of world.trailers) drawTrailer(f, tr);
      for (const g of world.grandstands) drawGrandstand(f, g);

      const towerSx = screenX(f, world.towerX, 1, 260);
      if (towerSx !== null) {
        ctx.save();
        ctx.translate(towerSx, 0);
        drawTimingTower(f);
        ctx.restore();
      }
      const wtSx = screenX(f, world.waterTowerX, 1, 200);
      if (wtSx !== null) {
        ctx.save();
        ctx.translate(wtSx, 0);
        drawWaterTower(f);
        ctx.restore();
      }
      for (const bb of world.billboards) drawBillboard(f, bb, world.usedBrands);

      drawTrack(f);
      if (fx.race) {
        drawChristmasTree(f, fx.race);
        drawRaceCars(f, fx);
        drawScoreboard(f, fx.race);
      }
      updateAndDrawParticles(f, fx, dt);
      drawForeground(f);
      drawVignette(f);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      onClick={toggleFullscreen}
      className={`fixed inset-0 z-50 overflow-hidden bg-[#5fb0d4] select-none ${uiVisible ? "" : "cursor-none"}`}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Clock — always on, like a proper screensaver */}
      <div className="absolute bottom-6 right-8 text-right pointer-events-none">
        <div className="text-white/90 text-5xl font-light tracking-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)] tabular-nums">
          {clock}
        </div>
        <div className="text-white/60 text-sm font-medium mt-1 drop-shadow-[0_1px_4px_rgba(0,0,0,0.4)]">
          {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
        </div>
      </div>

      <div className="absolute bottom-6 left-8 pointer-events-none">
        <div className="text-white/50 text-xs font-semibold tracking-widest uppercase drop-shadow-[0_1px_4px_rgba(0,0,0,0.4)]">
          Timing Data · Drag Strip Valley · v{APP_VERSION}
        </div>
      </div>

      {/* Chrome that fades out when idle */}
      <div className={`transition-opacity duration-500 ${uiVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <Link
          href="/"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-5 left-5 flex items-center gap-2 px-4 py-2 rounded-full bg-black/40 backdrop-blur text-white/90 text-sm font-medium hover:bg-black/60 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Exit
        </Link>
        <div className="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/40 backdrop-blur text-white/80 text-xs font-medium pointer-events-none">
          Click anywhere for fullscreen
        </div>
      </div>
    </div>
  );
}
