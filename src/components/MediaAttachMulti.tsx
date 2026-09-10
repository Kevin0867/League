"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

type Item = { url: string; type: "IMAGE" | "VIDEO"; name: string };

// Multi-file photo/video attachments for a form (e.g. the incident report).
// Each file uploads directly to Vercel Blob (so large videos bypass the
// serverless body limit); the collected list is serialized into one hidden
// input the form submits as `attachments` (JSON). The form's Send/Submit
// button(s) are disabled while any upload is in flight.
export function MediaAttachMulti({
  name = "attachments",
  prefix = "incident",
  initial = [],
}: {
  name?: string;
  /** Blob key folder, e.g. "facility" or "incident". */
  prefix?: string;
  /** Existing items to preload (e.g. a facility's saved photos when editing). */
  initial?: Item[];
}) {
  const [items, setItems] = useState<Item[]>(initial);
  const [pending, setPending] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

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
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file
    if (!files.length) return;
    setErr(null);
    for (const file of files) {
      setPending((n) => n + 1);
      setFormBusy(true);
      try {
        const isVideo = file.type.startsWith("video/");
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || (isVideo ? "clip.mp4" : "photo.jpg");
        const blob = await upload(`${prefix}/${Date.now()}-${safe}`, file, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          contentType: file.type,
        });
        setItems((prev) => [...prev, { url: blob.url, type: isVideo ? "VIDEO" : "IMAGE", name: file.name }]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "An upload failed — try again.");
      } finally {
        setPending((n) => {
          const left = n - 1;
          if (left === 0) setFormBusy(false);
          return left;
        });
      }
    }
  }

  return (
    <div ref={wrapRef}>
      <input type="hidden" name={name} value={JSON.stringify(items)} />

      {items.length > 0 && (
        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((it, i) => (
            <div key={i} className="relative overflow-hidden rounded-lg ring-1 ring-slate-200">
              {it.type === "VIDEO" ? (
                <video src={it.url} className="h-24 w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.url} alt={it.name} className="h-24 w-full object-cover" />
              )}
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs font-bold text-white"
                aria-label="Remove"
              >
                ✕
              </button>
              {it.type === "VIDEO" && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">video</span>}
            </div>
          ))}
        </div>
      )}

      <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 ${pending ? "opacity-60" : ""}`}>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
          multiple
          onChange={onPick}
          disabled={pending > 0}
          className="hidden"
        />
        📎 {pending > 0 ? `Uploading ${pending}… please wait to submit` : items.length ? "Add another photo / video" : "Add photos / video"}
      </label>
      {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
    </div>
  );
}
