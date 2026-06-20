"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "timindata_theme";

// Self-contained light/dark switch. The actual `data-theme` attribute is set on
// <html> before paint by the inline script in layout.tsx (so light-mode users
// don't flash dark on load); this component just reflects and flips it.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || "dark";
    setTheme(current);
    setMounted(true);
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode / storage disabled — theme still applies for this session */
    }
  }

  const isLight = mounted && theme === "light";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isLight}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
      onClick={() => apply(isLight ? "dark" : "light")}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-nhra-border bg-nhra-card transition-colors focus:outline-none focus:ring-2 focus:ring-nhra-accent"
    >
      {/* moon (dark) on the left, sun (light) on the right */}
      <svg className="absolute left-1 w-3 h-3 text-gray-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
      </svg>
      <svg className="absolute right-1 w-3 h-3 text-yellow-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
      </svg>
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-nhra-red shadow transition-transform ${
          isLight ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
