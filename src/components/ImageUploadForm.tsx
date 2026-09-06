"use client";

import { useState } from "react";

/** Profile-photo upload: shows the current photo + a file/camera picker. Multipart
 *  POST to the shared person-photo route. `capture` opens the camera on mobile;
 *  `compact` is a tighter layout for a roster row. */
export function ImageUploadForm({
  ticket,
  personId,
  returnTo,
  currentUrl,
  name,
  capture = false,
  compact = false,
  label = "Upload photo",
}: {
  ticket: string;
  /** Omit when uploading your own; set to upload for another person (admin, parent, or team coach). */
  personId?: string;
  returnTo: string;
  currentUrl?: string | null;
  name: string;
  capture?: boolean;
  compact?: boolean;
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  const size = compact ? "h-10 w-10" : "h-16 w-16";
  return (
    <form
      method="POST"
      action="/api/console/coach-image"
      encType="multipart/form-data"
      onSubmit={() => setPending(true)}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="ticket" value={ticket} />
      {personId && <input type="hidden" name="personId" value={personId} />}
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className={`${size} shrink-0 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200`}>
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-[9px] text-slate-400">No photo</div>
        )}
      </div>
      <input
        type="file"
        name="file"
        accept="image/jpeg,image/png,image/webp"
        {...(capture ? { capture: "environment" as const } : {})}
        required
        className="max-w-[14rem] text-xs sm:text-sm"
      />
      <button className="btn-secondary py-1 text-xs" disabled={pending}>{pending ? "Uploading…" : label}</button>
    </form>
  );
}
