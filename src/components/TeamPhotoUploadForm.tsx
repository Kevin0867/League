"use client";

import { useState, type FormEvent } from "react";
import { compressImage } from "@/lib/browser/compressImage";

/** Team photo upload (multipart). Admins or the team's coach. */
export function TeamPhotoUploadForm({ ticket, teamId, currentUrl }: { ticket: string; teamId: string; currentUrl?: string | null }) {
  const [pending, setPending] = useState(false);

  // Compress in-browser before upload so a large phone photo stays under the
  // serverless body limit (413). Falls back to a normal submit on any failure.
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const fileInput = form.querySelector('input[type="file"]') as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file) return;
    e.preventDefault();
    setPending(true);
    try {
      const compressed = await compressImage(file);
      const fd = new FormData();
      fd.set("ticket", ticket);
      fd.set("teamId", teamId);
      fd.set("file", compressed, (file.name.replace(/\.[^.]+$/, "") || "team") + ".jpg");
      const res = await fetch("/api/console/team-image", { method: "POST", body: fd });
      window.location.href = res.url || `/console/teams/${teamId}`;
    } catch {
      setPending(false);
      form.submit();
    }
  }

  return (
    <form
      method="POST"
      action="/api/console/team-image"
      encType="multipart/form-data"
      onSubmit={onSubmit}
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
      <input type="file" name="file" accept="image/jpeg,image/png,image/webp" capture="environment" required className="max-w-[16rem] text-sm" />
      <button type="submit" disabled={pending} className="btn-secondary text-sm disabled:opacity-60">
        {pending ? "Uploading…" : "Upload team photo"}
      </button>
    </form>
  );
}
