"use client";

import { useState } from "react";

/** Team photo upload (multipart). Admins or the team's coach. */
export function TeamPhotoUploadForm({ ticket, teamId, currentUrl }: { ticket: string; teamId: string; currentUrl?: string | null }) {
  const [pending, setPending] = useState(false);
  return (
    <form
      method="POST"
      action="/api/console/team-image"
      encType="multipart/form-data"
      onSubmit={() => setPending(true)}
      className="flex flex-wrap items-center gap-3"
    >
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="teamId" value={teamId} />
      <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentUrl} alt="Team photo" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-[10px] text-slate-400">No photo</div>
        )}
      </div>
      <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required className="max-w-[16rem] text-sm" />
      <button type="submit" disabled={pending} className="btn-secondary text-sm disabled:opacity-60">
        {pending ? "Uploading…" : "Upload team photo"}
      </button>
    </form>
  );
}
