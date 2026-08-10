"use client";

import { useState } from "react";

// Render an announcement's branded HTML (the exact email we sent) inside a
// sandboxed, auto-sizing iframe. The email's own action buttons (e.g. the pay
// links) stay clickable — allow-top-navigation-by-user-activation lets a click
// navigate the top window. No allow-scripts, so the trusted markup can't run JS.
export function MessageFrame({ html }: { html: string }) {
  const [height, setHeight] = useState(360);
  return (
    <iframe
      title="Announcement"
      srcDoc={html}
      sandbox="allow-same-origin allow-popups allow-top-navigation-by-user-activation"
      className="w-full rounded-lg border border-slate-100 bg-white"
      style={{ height }}
      onLoad={(e) => {
        try {
          const doc = e.currentTarget.contentDocument;
          if (doc?.body) setHeight(doc.body.scrollHeight + 8);
        } catch {
          /* cross-origin guard — keep default height */
        }
      }}
    />
  );
}
