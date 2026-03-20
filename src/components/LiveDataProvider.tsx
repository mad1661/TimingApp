"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";

export interface LiveConfig {
  username: string;
  password: string;
  season: string;
  eventType: string;
  eventCode: string;
  startDate: string;
  eventName: string;
  intervalSeconds: number;
  dateFilter?: string;
  racingStartHour?: number;
  pmStart?: boolean;
  categoryAliases?: Record<string, string>;
}

interface LiveDataState {
  config: LiveConfig | null;
  isActive: boolean;
  isFetching: boolean;
  lastFetch: Date | null;
  lastResult: { totalParsed: number; inserted: number } | null;
  lastError: string | null;
  totalNewRuns: number;
  setConfig: (config: LiveConfig) => void;
  start: () => void;
  stop: () => void;
  fetchNow: () => Promise<void>;
  clearConfig: () => void;
}

const LiveDataContext = createContext<LiveDataState | null>(null);

const STORAGE_KEY = "timindata_live_config";

function loadConfigFromStorage(): LiveConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveConfigToStorage(config: LiveConfig | null) {
  if (typeof window === "undefined") return;
  if (config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<LiveConfig | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [lastResult, setLastResult] = useState<{ totalParsed: number; inserted: number } | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [totalNewRuns, setTotalNewRuns] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const configRef = useRef(config);
  const activeRef = useRef(isActive);
  const fetchingRef = useRef(false);

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { activeRef.current = isActive; }, [isActive]);

  useEffect(() => {
    const stored = loadConfigFromStorage();
    if (stored) {
      setConfigState(stored);
      setIsActive(true);
    }
  }, []);

  const doFetch = useCallback(async () => {
    const cfg = configRef.current;
    if (!cfg || fetchingRef.current) return;
    if (!cfg.username || !cfg.password || !cfg.eventCode) return;

    fetchingRef.current = true;
    setIsFetching(true);
    setLastError(null);

    try {
      const res = await fetch("/api/fetch-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: cfg.username,
          password: cfg.password,
          season: cfg.season,
          eventType: cfg.eventType,
          eventCode: cfg.eventCode,
          startDate: cfg.startDate,
          eventName: cfg.eventName,
          dateFilter: cfg.dateFilter,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setLastResult({ totalParsed: data.totalParsed, inserted: data.inserted });
        if (data.inserted > 0) {
          setTotalNewRuns((prev) => prev + data.inserted);
        }
      } else {
        setLastError(data.error || "Fetch failed");
      }
      setLastFetch(new Date());
    } catch {
      setLastError("Network error");
    } finally {
      fetchingRef.current = false;
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (isActive && config && config.username && config.password && config.eventCode) {
      doFetch();
      if (config.intervalSeconds > 0) {
        intervalRef.current = setInterval(doFetch, config.intervalSeconds * 1000);
      }
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, config, doFetch]);

  const setConfig = useCallback((newConfig: LiveConfig) => {
    setConfigState(newConfig);
    saveConfigToStorage(newConfig);
  }, []);

  const start = useCallback(() => setIsActive(true), []);
  const stop = useCallback(() => {
    setIsActive(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  const clearConfig = useCallback(() => {
    setIsActive(false);
    setConfigState(null);
    setLastResult(null);
    setLastError(null);
    setTotalNewRuns(0);
    saveConfigToStorage(null);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  return (
    <LiveDataContext.Provider value={{
      config, isActive, isFetching, lastFetch, lastResult, lastError, totalNewRuns,
      setConfig, start, stop, fetchNow: doFetch, clearConfig,
    }}>
      {children}
    </LiveDataContext.Provider>
  );
}

export function useLiveData() {
  const ctx = useContext(LiveDataContext);
  if (!ctx) throw new Error("useLiveData must be used within LiveDataProvider");
  return ctx;
}
