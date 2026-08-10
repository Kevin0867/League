import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PURE Academy — Arizona's Premier Player Development Academy",
    template: "%s · PURE Academy",
  },
  description:
    "PURE Academy is Arizona's premier player development academy. We believe team training accelerates player development — players train, compete, and improve together. Fall 2026 season now enrolling, all ages and skill levels.",
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
