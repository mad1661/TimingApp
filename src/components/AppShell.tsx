"use client";

import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { useLiveData } from "./LiveDataProvider";
import Navbar from "./Navbar";

export default function AppShell({ children }: { children: ReactNode }) {
  const live = useLiveData();
  const pathname = usePathname();

  const hasConfig = !!live.config;
  const isSetupPage = pathname === "/" && !hasConfig;
  const isStandaloneSharedPage = pathname.startsWith("/day/");

  if (isSetupPage || isStandaloneSharedPage) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <>
      <Navbar />
      <main className="lg:ml-64 min-h-screen p-4 lg:p-8">{children}</main>
    </>
  );
}
