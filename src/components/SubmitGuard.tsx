"use client";
import { useEffect } from "react";

// Prevent accidental double-submits. Our forms POST natively and the server
// answers with a redirect + full page load, which can feel slow — so an
// impatient tap-tap-tap on a Send/Save button fires the same POST several times
// before the page navigates (e.g. a coach's "checking in" message landing eight
// times). Once a form is submitted we disable its submit button for the life of
// the navigation, so only the first press counts.
//
// The submission itself is never blocked: the browser has already serialized
// the form and begun navigating by the time this runs, so disabling the button
// a frame later cannot cancel it. A safety timer re-enables the button if the
// page didn't navigate (client validation kept us here, or the request failed),
// and a form can opt out with data-allow-multisubmit="true".
export function SubmitGuard() {
  useEffect(() => {
    const onSubmit = (e: Event) => {
      const target = e.target as HTMLFormElement | null;
      if (!target || target.tagName !== "FORM") return;
      if ((target.getAttribute("method") || "").toLowerCase() !== "post") return;
      if (target.dataset.allowMultisubmit === "true") return;

      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      const btn =
        submitter && submitter.tagName === "BUTTON"
          ? submitter
          : target.querySelector<HTMLButtonElement>('button[type="submit"], button:not([type])');
      if (!btn || btn.disabled) return;

      requestAnimationFrame(() => {
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
      });
      // Navigation normally replaces the page before this fires. If it didn't
      // (validation error, network failure), give the button back.
      window.setTimeout(() => {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
      }, 12000);
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  return null;
}
