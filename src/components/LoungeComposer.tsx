"use client";

import { useState } from "react";
import { MediaAttach } from "@/components/MediaAttach";

// The Coaches' Lounge post box. Posting is harmless, but "Email everyone" and
// "Text everyone" reach every coach and admin — so those confirm first, with the
// channel spelled out. Plain in-app posts send with no interruption.
export function LoungeComposer({ ticket, admin }: { ticket: string; admin: boolean }) {
  const [notify, setNotify] = useState("INAPP");
  const broadcast = notify === "EMAIL" || notify === "TEXT";
  return (
    <form
      method="POST"
      action="/api/console/lounge"
      className="space-y-3"
      onSubmit={(e) => {
        const body = (e.currentTarget.elements.namedItem("body") as HTMLTextAreaElement | null)?.value?.trim();
        if (!body) {
          e.preventDefault();
          return;
        }
        if (broadcast) {
          const how = notify === "TEXT" ? "text every coach and admin" : "email every coach and admin";
          if (!window.confirm(`This will ${how}. Post and notify?`)) {
            e.preventDefault();
          }
        }
      }}
    >
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="post" />
      <textarea
        name="body"
        rows={3}
        maxLength={4000}
        placeholder="Say something to the coaches… (banter, a heads-up, or 'need a sub for Mesa MID this Thursday')"
        className="input w-full"
      />
      <MediaAttach label="Add photo / video" library />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-sm text-slate-600">
          Notify staff:{" "}
          <select name="notify" value={notify} onChange={(e) => setNotify(e.target.value)} className="input ml-1 inline-block w-auto py-1 text-sm">
            <option value="NONE">Just post (no ping)</option>
            <option value="INAPP">On the board + in-app</option>
            <option value="EMAIL">Email everyone</option>
            <option value="TEXT">Text everyone (important)</option>
          </select>
        </label>
        <div className="flex items-center gap-3">
          {admin && (
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" name="pinned" className="accent-brand-600" /> Pin (announcement)
            </label>
          )}
          <button className="btn-accent text-sm">Post</button>
        </div>
      </div>
    </form>
  );
}
