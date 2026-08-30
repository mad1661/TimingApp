"use client";

import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { useLiveData } from "./LiveDataProvider";
import Navbar from "./Navbar";
import EventBanner from "./EventBanner";

export default function AppShell({ children }: { children: ReactNode }) {
  const live = useLiveData();
  const pathname = usePathname();

  const hasConfig = !!live.config;
  const isSetupPage = pathname === "/" && !hasConfig;
  // Pages handed to people outside the tower carry none of the app's chrome —
  // no navigation, no event banner, nothing to press. "/p/" is the short
  // points link.
  const isStandaloneSharedPage =
    pathname.startsWith("/day/") || pathname.startsWith("/share") || pathname.startsWith("/p/");

  if (isSetupPage || isStandaloneSharedPage) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <>
      <Navbar />
      <main className="lg:ml-64 min-h-screen p-4 lg:p-8">
        <div className="print:hidden">
          <EventBanner />
        </div>
        {children}
      </main>
    </>
  );
}
