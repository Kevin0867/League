"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Keep the unread banner/badge live. The layout renders the count server-side;
// this polls the current count and, whenever it differs from what's displayed
// (a new message arrived, or one was read elsewhere), refreshes the route tree
// so the layout recomputes — the badge ticks up on a new message without a
// manual reload. Polls on an interval and whenever the tab regains focus, so a
// returning user sees the current state immediately.
export function UnreadPoller({
  count,
  broadcast = 0,
  trackBroadcast = false,
  intervalMs = 30000,
}: {
  count: number;
  broadcast?: number;
  /** Also refresh when the broadcast/announcement count changes (the console
   *  shows that badge; the portal doesn't, so it leaves this off). */
  trackBroadcast?: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  // Track the values the layout is currently showing (updated on every render,
  // including after a refresh) so we only refresh on a real change.
  const shown = useRef({ count, broadcast });
  shown.current = { count, broadcast };

  useEffect(() => {
    let stop = false;
    async function check() {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch("/api/inbox/unread", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { count?: number; broadcast?: number };
        if (stop) return;
        const c = typeof j.count === "number" ? j.count : shown.current.count;
        const b = typeof j.broadcast === "number" ? j.broadcast : shown.current.broadcast;
        const changed = c !== shown.current.count || (trackBroadcast && b !== shown.current.broadcast);
        if (changed) router.refresh();
      } catch {
        /* transient network error — try again next tick */
      }
    }
    const id = window.setInterval(check, intervalMs);
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      stop = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [intervalMs, router, trackBroadcast]);

  return null;
}
