"use client";

import { useState } from "react";

// First-party newsletter signup — replaces the embedded Zoho web-optin form
// (which posted to a third-party endpoint and could 404). Submits to our own
// /api/newsletter, which records consent and subscribes the contact to Zoho
// Campaigns server-side, then shows an inline thank-you without navigating.

const INPUT =
  "h-11 w-full rounded-lg border border-white/20 bg-white/[0.06] px-3 text-sm text-white placeholder:text-white/45 focus:border-[#8ab800] focus:outline-none";

export function NewsletterForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "sending") return;
    const fd = new FormData(e.currentTarget);
    const payload = {
      firstName: String(fd.get("firstName") ?? ""),
      lastName: String(fd.get("lastName") ?? ""),
      email: String(fd.get("email") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      consent: fd.get("consent") === "on",
    };
    setStatus("sending");
    setError("");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setStatus("done");
      } else {
        setError(data.error || "Something went wrong — please try again.");
        setStatus("error");
      }
    } catch {
      setError("Couldn't reach the server — please try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-xl border border-[#8ab800]/40 bg-[#8ab800]/[0.12] p-5 text-white">
        <div className="text-base font-bold">Thanks for subscribing! 🎉</div>
        <p className="mt-1.5 text-sm leading-relaxed text-white/70">
          You&apos;re on the list. If our newsletter uses double opt-in, check your email for a confirmation link to finish.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="w-full">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row">
        <input name="firstName" type="text" placeholder="First name" className={INPUT} maxLength={100} autoComplete="given-name" />
        <input name="lastName" type="text" placeholder="Last name" className={INPUT} maxLength={80} autoComplete="family-name" />
      </div>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row">
        <input name="email" type="email" required placeholder="Email address *" className={INPUT} maxLength={120} autoComplete="email" />
        <input name="phone" type="tel" placeholder="Mobile (optional)" className={INPUT} maxLength={20} autoComplete="tel" />
      </div>
      <label className="mb-3 mt-1 flex items-start gap-2 text-[11px] leading-relaxed text-white/50">
        <input name="consent" type="checkbox" required className="mt-0.5 flex-shrink-0" />
        <span>
          I agree to the{" "}
          <a href="https://purepickleball.com/privacy-policy-2/" target="_blank" rel="noopener noreferrer" className="text-[#8ab800] underline">Privacy Policy</a>{" "}&amp;{" "}
          <a href="https://purepickleball.com/auto-draft-2/" target="_blank" rel="noopener noreferrer" className="text-[#8ab800] underline">Terms of Use</a>{" "}
          and to receive email and SMS communications from PURE Pickleball and Padel. *Required
        </span>
      </label>
      {status === "error" && (
        <p className="mb-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
      )}
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-lg bg-[#8ab800] px-7 py-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-white hover:bg-[#729a00] disabled:opacity-60"
      >
        {status === "sending" ? "Subscribing…" : "Subscribe"}
      </button>
    </form>
  );
}
