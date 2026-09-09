"use client";

import { useState, type FormEvent } from "react";
import { compressImage } from "@/lib/browser/compressImage";

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

  // Compress the photo in the browser before upload so a large phone image
  // doesn't exceed the serverless body limit (413). Falls back to a plain submit
  // if anything about the client-side path fails.
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const fileInput = form.querySelector('input[type="file"]') as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file) return; // let the browser enforce `required`
    e.preventDefault();
    setPending(true);
    try {
      const compressed = await compressImage(file);
      const fd = new FormData();
      fd.set("ticket", ticket);
      if (personId) fd.set("personId", personId);
      fd.set("returnTo", returnTo);
      fd.set("file", compressed, (file.name.replace(/\.[^.]+$/, "") || "photo") + ".jpg");
      const res = await fetch("/api/console/coach-image", { method: "POST", body: fd });
      window.location.href = res.url || returnTo;
    } catch {
      // Fall back to a normal multipart submit (may 413 on very large files).
      setPending(false);
      form.submit();
    }
  }

  return (
    <form
      method="POST"
      action="/api/console/coach-image"
      encType="multipart/form-data"
      onSubmit={onSubmit}
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
