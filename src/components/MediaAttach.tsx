"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

// A photo/video attachment picker for message forms. Uploads the file directly
// to Vercel Blob (bypassing the serverless body limit, so a full practice video
// works), then writes the resulting URL + kind into hidden inputs the form
// submits. Shows a preview and a remove button. In-flight it disables the
// surrounding submit via the `name="__uploading"` marker some forms check, and
// always via its own state.
export function MediaAttach({ label = "Add photo / video" }: { label?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [type, setType] = useState<"IMAGE" | "VIDEO" | null>(null);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // While a file is uploading, disable the surrounding form's Send button(s) so a
  // message can't be sent before its attachment finishes (a big video takes a
  // moment). Our own controls (inside wrapRef) are left alone. Works whether the
  // parent form is a server or client component.
  function setFormBusy(busy: boolean) {
    const form = wrapRef.current?.closest("form");
    if (!form) return;
    form.querySelectorAll("button").forEach((b) => {
      if (wrapRef.current?.contains(b)) return;
      const t = (b.getAttribute("type") ?? "submit").toLowerCase();
      if (t === "submit") (b as HTMLButtonElement).disabled = busy;
    });
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setPending(true);
    setFormBusy(true);
    try {
      const isVideo = file.type.startsWith("video/");
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || (isVideo ? "clip.mp4" : "photo.jpg");
      const blob = await upload(`attachments/${Date.now()}-${safe}`, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        contentType: file.type,
      });
      setUrl(blob.url);
      setType(isVideo ? "VIDEO" : "IMAGE");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed — try again.");
    } finally {
      setPending(false);
      setFormBusy(false);
    }
  }

  return (
    <div ref={wrapRef} className="text-sm">
      {url && <input type="hidden" name="attachmentUrl" value={url} />}
      {type && <input type="hidden" name="attachmentType" value={type} />}

      {url ? (
        <div className="mt-1 flex items-start gap-2">
          {type === "VIDEO" ? (
            <video src={url} controls className="max-h-40 rounded-lg ring-1 ring-slate-200" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="attachment preview" className="max-h-40 rounded-lg ring-1 ring-slate-200" />
          )}
          <button
            type="button"
            onClick={() => { setUrl(null); setType(null); }}
            className="text-xs font-medium text-rose-600 hover:underline"
          >
            Remove
          </button>
        </div>
      ) : (
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 ${pending ? "opacity-60" : ""}`}>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
            onChange={onPick}
            disabled={pending}
            className="hidden"
          />
          📎 {pending ? "Uploading… please wait to send" : label}
        </label>
      )}
      {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
    </div>
  );
}
