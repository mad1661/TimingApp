/**
 * Bootstrap for the standalone (macOS .saver) build of Drag Strip Valley.
 * Bundled by scripts/build-saver-html.ts into a single self-contained HTML
 * file loaded by a WKWebView inside the native screensaver — no network,
 * no React, no Next.js.
 */

import { startScreensaver } from "../src/lib/screensaver-engine";

function boot() {
  const canvas = document.getElementById("scene") as HTMLCanvasElement | null;
  if (!canvas) return;
  startScreensaver(canvas);

  const clockEl = document.getElementById("clock");
  const dateEl = document.getElementById("date");
  const tick = () => {
    if (clockEl) clockEl.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    }
  };
  tick();
  setInterval(tick, 1000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
