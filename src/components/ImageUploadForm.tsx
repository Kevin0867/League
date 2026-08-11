"use client";

import { useState } from "react";

/** Profile-image upload: shows the current photo + a file picker. Multipart POST. */
export function ImageUploadForm({
  ticket,
  personId,
  returnTo,
  currentUrl,
  name,
}: {
  ticket: string;
  /** Omit when the signed-in coach uploads their own; set to upload for another coach (admin). */
  personId?: string;
  returnTo: string;
  currentUrl?: string | null;
  name: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <form
      method="POST"
      action="/api/console/coach-image"
      encType="multipart/form-data"
      onSubmit={() => setPending(true)}
      className="flex flex-wrap items-center gap-3"
    >
      <input type="hidden" name="ticket" value={ticket} />
      {personId && <input type="hidden" name="personId" value={personId} />}
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-[10px] text-slate-400">No photo</div>
        )}
      </div>
      <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required className="max-w-[16rem] text-sm" />
      <button className="btn-secondary text-sm" disabled={pending}>{pending ? "Uploading…" : "Upload photo"}</button>
    </form>
  );
}
