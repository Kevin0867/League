"use client";

import { useState } from "react";
import { MediaAttach } from "@/components/MediaAttach";

// A coach's broadcast composer: message a whole group at once. Defaults to the
// coach's own team (the common case), shows how many people the chosen audience
// reaches, and confirms before sending since it's a real text/email blast to
// families. Every send is logged per-person in Communications for admins.
export type BroadcastAudience = {
  value: string; // "ALL_COACHES" | "ALL_ADMINS" | "TEAM:<id>"
  label: string; // shown in the dropdown
  // People count for the audience, when known (team size); null = not counted.
  count: number | null;
  // How the count reads in the confirm ("14 players and their parents").
  reachNote: string;
};

export function CoachBroadcastComposer({
  ticket,
  returnTo,
  audiences,
}: {
  ticket: string;
  returnTo: string;
  audiences: BroadcastAudience[];
}) {
  // Default to the first team the coach owns; fall back to the first audience.
  const firstTeam = audiences.find((a) => a.value.startsWith("TEAM:"));
  const [value, setValue] = useState((firstTeam ?? audiences[0])?.value ?? "");
  const [pending, setPending] = useState(false);
  const selected = audiences.find((a) => a.value === value);

  return (
    <div className="card">
      <h2 className="font-semibold text-slate-900">Send a broadcast</h2>
      <p className="mt-0.5 text-sm text-slate-500">Message a whole group at once. It&apos;s recorded like every other message.</p>
      <form
        method="POST"
        action="/api/console/messages"
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          const form = e.currentTarget;
          const body = (form.elements.namedItem("body") as HTMLTextAreaElement | null)?.value?.trim();
          const hasAttachment = !!(form.elements.namedItem("attachmentUrl") as HTMLInputElement | null)?.value;
          if (!body && !hasAttachment) {
            e.preventDefault();
            return;
          }
          const sms = (form.elements.namedItem("channel_SMS") as HTMLInputElement | null)?.checked;
          const email = (form.elements.namedItem("channel_EMAIL") as HTMLInputElement | null)?.checked;
          const how = [sms ? "text" : null, email ? "email" : null, "the app"].filter(Boolean).join(" + ");
          const who = selected ? selected.reachNote : "this group";
          if (!window.confirm(`Send this to ${who} via ${how}?`)) {
            e.preventDefault();
            return;
          }
          setPending(true);
        }}
      >
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="send" />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="channel_IN_APP" value="on" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">To</label>
            <select name="audienceType" className="input" value={value} onChange={(e) => setValue(e.target.value)}>
              {audiences.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
            {selected && selected.count != null && (
              <p className="mt-1 text-xs text-slate-500">Reaches {selected.reachNote}.</p>
            )}
          </div>
          <div>
            <label className="label">Subject (optional)</label>
            <input name="subject" className="input" placeholder="e.g. Practice moved this week" />
          </div>
        </div>
        <div>
          <label className="label">Message</label>
          <textarea name="body" rows={4} className="input" placeholder="Write your message…" />
          <div className="mt-2">
            <MediaAttach label="Attach a photo / video" library />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" name="channel_SMS" value="on" defaultChecked /> Text (SMS)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" name="channel_EMAIL" value="on" /> Also send by email
            </label>
          </div>
          <button type="submit" disabled={pending} className="btn-primary text-sm disabled:opacity-60">
            {pending ? "Sending…" : "Send broadcast"}
          </button>
        </div>
      </form>
    </div>
  );
}
