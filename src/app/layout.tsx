import type { Metadata } from "next";
import "./globals.css";
import { LiveDataProvider } from "@/components/LiveDataProvider";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Timing Data - NHRA Race Analytics",
  description: "NHRA drag racing timing data analytics and visualization",
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
