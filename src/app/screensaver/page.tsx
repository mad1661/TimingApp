"use client";

/**
 * In-app host for the Drag Strip Valley screensaver. The animation itself
 * lives in src/lib/screensaver-engine.ts (shared with the native macOS
 * screensaver in macos-screensaver/); this page adds the web chrome:
 * fullscreen toggle, idle cursor hiding, clock and exit link.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { startScreensaver } from "@/lib/screensaver-engine";
import { APP_VERSION } from "@/lib/version";

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
    return startScreensaver(canvas);
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
