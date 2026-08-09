import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PURE Academy & Arizona Club Pickleball",
    template: "%s · PURE Academy",
  },
  description:
    "Season management for PURE Academy and Arizona Club Pickleball — registration, teams, scheduling, league play, and payments.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Mobile-first: coaches mark attendance courtside on a phone (§18).
  themeColor: "#0e1d34",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
