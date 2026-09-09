"use client";

import { useState } from "react";

// Star rating + testimonial + optional coach + publish consent. Posts to the
// public feedback API with the signed token.
export function FeedbackForm({ token, coaches, defaultName, defaultCoachId }: { token: string; coaches: { id: string; name: string }[]; defaultName: string; defaultCoachId?: string | null }) {
  const [rating, setRating] = useState(0);
  const [pending, setPending] = useState(false);

  return (
    <form method="POST" action="/api/feedback" onSubmit={() => setPending(true)} className="mt-6 space-y-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="rating" value={rating} />

      <div>
        <label className="block text-sm font-semibold text-slate-700">How was it?</label>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              className={`text-3xl leading-none ${n <= rating ? "text-amber-400" : "text-slate-300"} hover:text-amber-400`}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      {coaches.length > 0 && (
        <div>
          <label className="block text-sm font-semibold text-slate-700" htmlFor="coachId">Which coach? (optional)</label>
          <select id="coachId" name="coachId" defaultValue={defaultCoachId ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
            <option value="">— the program overall —</option>
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="block text-sm font-semibold text-slate-700" htmlFor="body">Your feedback / testimonial</label>
        <textarea id="body" name="body" rows={5} maxLength={1500} required placeholder="What went well? What could be better? A note about your coach?" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700" htmlFor="respondentName">Your name (for a published testimonial)</label>
        <input id="respondentName" name="respondentName" defaultValue={defaultName} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="consentPublish" value="1" className="mt-0.5 h-4 w-4" />
        <span>PURE Academy may share this (and my name) as a testimonial on our website and the coach&apos;s profile.</span>
      </label>

      <button disabled={pending} className="w-full rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
        {pending ? "Sending…" : "Send feedback"}
      </button>
    </form>
  );
}
