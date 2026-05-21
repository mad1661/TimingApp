"use client";

import { useState } from "react";
import type { NhraEvent, EventDate } from "@/lib/nhra-setup";

// Shared login + event/day selection state for the onboarding SetupFlow and the
// in-app /setup page. Each consumer keeps its own effects (auto-loading a stored
// config, navigation, polling interval) and drives this state via the setters.
export function useNhraSetup() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [season, setSeason] = useState("2026");
  const [eventType, setEventType] = useState("N");
  const [events, setEvents] = useState<NhraEvent[]>([]);
  const [selectedEventIdx, setSelectedEventIdx] = useState<number>(-1);
  const [eventsLoading, setEventsLoading] = useState(false);

  const [eventDates, setEventDates] = useState<EventDate[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [datesLoading, setDatesLoading] = useState(false);

  async function handleLogin() {
    setLoginLoading(true);
    setLoginError("");
    try {
      const res = await fetch("/api/fetch-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, season, eventType }),
      });
      const data = await res.json();
      if (data.success && data.events) {
        setEvents(data.events);
        setLoggedIn(true);
        setSelectedEventIdx(-1);
        setEventDates([]);
        setSelectedDate("");
      } else {
        setLoginError(data.error || "Login failed. Check your credentials.");
      }
    } catch {
      setLoginError("Network error. Could not reach the server.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function loadEvents() {
    setEventsLoading(true);
    try {
      const res = await fetch("/api/fetch-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, season, eventType }),
      });
      const data = await res.json();
      if (data.success && data.events) setEvents(data.events);
    } catch {}
    setEventsLoading(false);
  }

  async function loadEventDates(event: NhraEvent) {
    setDatesLoading(true);
    setSelectedDate("");
    try {
      const res = await fetch("/api/fetch-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, action: "dates", event }),
      });
      const data = await res.json();
      if (data.success && data.dates) setEventDates(data.dates);
    } catch {}
    setDatesLoading(false);
  }

  function handleEventSelect(idx: number) {
    setSelectedEventIdx(idx);
    setEventDates([]);
    setSelectedDate("");
    if (idx >= 0 && events[idx]) loadEventDates(events[idx]);
  }

  const selectedEvent = selectedEventIdx >= 0 ? events[selectedEventIdx] : null;

  return {
    username, setUsername,
    password, setPassword,
    loggedIn, setLoggedIn,
    loginLoading, loginError,
    season, setSeason,
    eventType, setEventType,
    events, setEvents,
    selectedEventIdx, setSelectedEventIdx,
    eventsLoading,
    eventDates, setEventDates,
    selectedDate, setSelectedDate,
    datesLoading, setDatesLoading,
    selectedEvent,
    handleLogin, loadEvents, loadEventDates, handleEventSelect,
  };
}
