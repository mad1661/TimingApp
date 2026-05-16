import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LiveDataProvider } from "@/components/LiveDataProvider";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Timing Data - NHRA Race Analytics",
  description: "NHRA drag racing timing data analytics and visualization",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <LiveDataProvider>
          <AppShell>{children}</AppShell>
        </LiveDataProvider>
      </body>
    </html>
  );
}
