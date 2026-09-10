import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "BaseStocks Bot",
  description: "Telegram bots for BaseStocks and the BaseStocks Launchpad.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
          fontSize: 14,
          lineHeight: 1.7,
          color: "var(--ink, #14171f)",
          background: "var(--page-bg, #fbfbfd)",
        }}
      >
        {children}
      </body>
    </html>
  );
}
