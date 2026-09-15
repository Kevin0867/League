"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The unread banner + nav badge are rendered by the console/portal layout, which
// Next.js keeps mounted across soft navigations — so opening a thread and marking
// it read doesn't refresh that count on its own. When a thread we just opened had
// unread messages, refresh the route tree once so the layout recomputes and the
// badge clears. router.refresh() re-runs the server components (layout included)
// without dropping client state, and does not remount this component, so the
// effect fires exactly once.
export function RefreshOnRead({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (active) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
