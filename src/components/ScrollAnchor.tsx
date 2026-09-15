"use client";
import { useEffect } from "react";

// Keep the page anchored where you were after you make a change. Our forms
// submit natively (POST) and the server answers with a redirect, so the browser
// loads a fresh document and jumps to the top — losing your place on a long
// page. This stashes the scroll position the instant a form on the current page
// is submitted, then restores it once the page reloads at the same path.
//
// It only acts on a genuine post-submit reload: the stash carries a timestamp
// and is consumed once, so a normal visit, a back/forward, or a submit that
// redirects somewhere else never triggers a stale jump. Browser-native scroll
// restoration (for back/forward) is left untouched.
export function ScrollAnchor() {
  useEffect(() => {
    const key = `pa-scroll:${location.pathname}`;

    // Restore, if we just came back from submitting a form on this same path.
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        sessionStorage.removeItem(key);
        const saved = JSON.parse(raw) as { y: number; t: number };
        if (typeof saved?.y === "number" && Date.now() - saved.t < 8000) {
          // Restore after layout settles so the offset is reachable, and again
          // on full load in case late content (images) shifted the height.
          const to = () => window.scrollTo(0, saved.y);
          requestAnimationFrame(to);
          window.addEventListener("load", to, { once: true });
        }
      }
    } catch {}

    // Stash the current position on any native POST form submit on this page.
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || (form.method || "").toLowerCase() !== "post") return;
      try {
        sessionStorage.setItem(key, JSON.stringify({ y: window.scrollY, t: Date.now() }));
      } catch {}
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  return null;
}
