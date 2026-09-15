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
      {
        // The authenticated app surfaces (family portal + staff console) are
        // server-rendered per request, but mobile browsers' back/forward cache
        // (bfcache) can still show a stale copy — e.g. a "waiver outstanding"
        // notice from before the sign link existed, or an action that already
        // completed. Force a fresh fetch so people always see current state.
        source: "/portal/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        source: "/portal",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        source: "/console/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
