import type { Metadata, Viewport } from "next";
import { Inter, Barlow_Semi_Condensed, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { LiveDataProvider } from "@/components/LiveDataProvider";
import AppShell from "@/components/AppShell";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const barlow = Barlow_Semi_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

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
    <html lang="en" className={`${inter.variable} ${barlow.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* Apply the saved theme before first paint so light-mode users don't
            flash the dark theme on load. Defaults to dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('timindata_theme');document.documentElement.dataset.theme=(t==='light')?'light':'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();",
          }}
        />
      </head>
      <body className="antialiased">
        <LiveDataProvider>
          <AppShell>{children}</AppShell>
        </LiveDataProvider>
      </body>
    </html>
  );
}
