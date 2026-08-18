"use client";

import { useState } from "react";
import { SpeechToTextArea } from "./SpeechToTextArea";

// Coach composes a team update (with voice dictation) and sends it to everyone
// on the team — players and their parents — in one tap. Confirms before sending
// since it's a real broadcast.
export function TeamUpdateComposer({ ticket, teamId, teamName }: { ticket: string; teamId: string; teamName: string }) {
  const [pending, setPending] = useState(false);
  return (
    <form
      method="POST"
      action="/api/console/team-notes"
      onSubmit={(e) => {
        const body = (e.currentTarget.elements.namedItem("body") as HTMLTextAreaElement | null)?.value?.trim();
        if (!body) {
          e.preventDefault();
          return;
        }
        if (!window.confirm(`Send this update to everyone on ${teamName} — players and parents?`)) {
          e.preventDefault();
          return;
        }
        setPending(true);
      }}
    >
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="broadcastTeam" />
      <input type="hidden" name="teamId" value={teamId} />
      <SpeechToTextArea
        name="body"
        rows={5}
        ariaLabel="Team update message"
        placeholder={"e.g. Great work today on dinks and resets. This week, please work on your third-shot drop — we'll move on to drives next week."}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="channel_SMS" value="on" defaultChecked /> Also text this to the team
        </label>
        <button type="submit" disabled={pending} className="btn-primary w-full sm:w-auto disabled:opacity-60">
          {pending ? "Sending…" : "Send to all"}
        </button>
      </div>
    </form>
  );
}
