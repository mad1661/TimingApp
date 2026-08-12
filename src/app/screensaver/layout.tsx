import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Screensaver",
  description: "Animated drag racing valley screensaver.",
  robots: { index: false, follow: false },
};

export default function ScreensaverLayout({ children }: { children: ReactNode }) {
  return children;
}
