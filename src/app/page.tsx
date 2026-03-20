"use client";

import { useLiveData } from "@/components/LiveDataProvider";
import SetupFlow from "@/components/SetupFlow";
import Dashboard from "@/components/Dashboard";

export default function HomePage() {
  const live = useLiveData();

  if (!live.config) {
    return <SetupFlow />;
  }

  return <Dashboard />;
}
