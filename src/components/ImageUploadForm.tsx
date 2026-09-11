"use client";

import { useId, useState, type FormEvent } from "react";
import { compressImage } from "@/lib/browser/compressImage";
import { PhotoCropper } from "@/components/PhotoCropper";

/** Profile-photo upload: shows the current photo + a file/camera picker. Multipart
 *  POST to the shared person-photo route. `capture` opens the camera on mobile;
 *  `compact` is a tighter layout for a roster row. When `cropAspect` is set the
 *  user crops the photo (to that width/height ratio) before it uploads, so
 *  headshots frame cleanly instead of being top-cropped by the card. */
export function ImageUploadForm({
  ticket,
  personId,
  returnTo,
  currentUrl,
  name,
  capture = false,
  compact = false,
  label = "Upload photo",
  cropAspect,
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
  /** When set (e.g. 4/3), show a crop tool before upload. */
  cropAspect?: number;
}) {
  const [pending, setPending] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropped, setCropped] = useState<{ blob: Blob; url: string } | null>(null);
  const size = compact ? "h-10 w-10" : "h-16 w-16";
  const inputId = useId();

  async function uploadBlob(blob: Blob) {
    setPending(true);
    try {
      const file = new File([blob], "photo.jpg", { type: "image/jpeg" });
      const compressed = await compressImage(file);
      const fd = new FormData();
      fd.set("ticket", ticket);
      if (personId) fd.set("personId", personId);
      fd.set("returnTo", returnTo);
      fd.set("file", compressed, "photo.jpg");
      const res = await fetch("/api/console/coach-image", { method: "POST", body: fd });
      window.location.href = res.url || returnTo;
    } catch {
      setPending(false);
      alert("Upload failed — please try again.");
    }
  }

  // Non-crop path: compress the picked file in the browser before upload so a
  // large phone image doesn't exceed the serverless body limit (413).
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    if (cropAspect) {
      e.preventDefault();
      if (cropped) await uploadBlob(cropped.blob);
      return;
    }
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
      setPending(false);
      form.submit();
    }
  }

  const previewUrl = cropped?.url ?? currentUrl ?? null;

  return (
    <>
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
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-[9px] text-slate-400">No photo</div>
          )}
        </div>

        {cropAspect ? (
          <>
            <input
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              {...(capture ? { capture: "environment" as const } : {})}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setCropFile(f);
                e.target.value = ""; // allow re-picking the same file
              }}
              className="hidden"
            />
            <label htmlFor={inputId} className="btn-secondary cursor-pointer py-1 text-xs">
              {cropped ? "Change photo" : "Choose photo"}
            </label>
            {cropped && (
              <button type="submit" className="btn-primary py-1 text-xs" disabled={pending}>
                {pending ? "Uploading…" : label}
              </button>
            )}
          </>
        ) : (
          <>
            <input
              type="file"
              name="file"
              accept="image/jpeg,image/png,image/webp"
              {...(capture ? { capture: "environment" as const } : {})}
              required
              className="max-w-[14rem] text-xs sm:text-sm"
            />
            <button className="btn-secondary py-1 text-xs" disabled={pending}>{pending ? "Uploading…" : label}</button>
          </>
        )}
      </form>

      {cropFile && cropAspect && (
        <PhotoCropper
          file={cropFile}
          aspect={cropAspect}
          onCancel={() => setCropFile(null)}
          onDone={(blob) => {
            setCropped((prev) => {
              if (prev?.url) URL.revokeObjectURL(prev.url);
              return { blob, url: URL.createObjectURL(blob) };
            });
            setCropFile(null);
          }}
        />
      )}
    </>
  );
}
