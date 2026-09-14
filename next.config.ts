import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [
      {
        // Public no-login flows (waiver signing/renewal) must never be served
        // from a browser or CDN cache — a stale copy of an older page could show
        // a broken form. Always revalidate.
        source: "/waiver/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
