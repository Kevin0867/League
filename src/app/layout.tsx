import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://academy.purepickleball.com"),
  title: {
    default: "PURE Academy — Arizona's Premier Player Development Academy",
    template: "%s · PURE Academy",
  },
  description:
    "Team-based pickleball training for all ages and levels. Fall 2026 season now enrolling — twelve sessions, September 14 to December 13.",
  alternates: { canonical: "/" },
  openGraph: {
    siteName: "PURE Academy",
    type: "website",
    images: ["/brand/pure-academy-elite.png"],
  },
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
