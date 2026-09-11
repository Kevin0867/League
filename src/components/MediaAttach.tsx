"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

type LibVideo = { id: string; title: string; category: string | null; skillLevel: string | null; videoUrl: string; videoType: string | null };

// A photo/video attachment picker for message forms. Two sources:
//   • Upload a file (straight to Vercel Blob, bypassing the body limit), or
//   • when `library` is set (staff composers), pick one from the Training Video
//     library — no re-upload.
// Either way it writes the chosen URL + kind into hidden inputs the form submits.
export function MediaAttach({ label = "Add photo / video", library = false }: { label?: string; library?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [type, setType] = useState<"IMAGE" | "VIDEO" | null>(null);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
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
        <div className="flex flex-wrap items-center gap-2">
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
          {library && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-brand-700 hover:bg-brand-100"
            >
              📚 From library
            </button>
          )}
        </div>
      )}
      {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}

      {pickerOpen && (
        <LibraryPicker
          onCancel={() => setPickerOpen(false)}
          onPick={(v) => { setUrl(v.videoUrl); setType(v.videoType === "IMAGE" ? "IMAGE" : "VIDEO"); setPickerOpen(false); }}
        />
      )}
    </div>
  );
}

function LibraryPicker({ onPick, onCancel }: { onPick: (v: LibVideo) => void; onCancel: () => void }) {
  const [videos, setVideos] = useState<LibVideo[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    let alive = true;
    fetch("/api/console/training")
      .then((r) => r.json())
      .then((d) => { if (alive) setVideos(Array.isArray(d.videos) ? d.videos : []); })
      .catch(() => { if (alive) setVideos([]); });
    return () => { alive = false; };
  }, []);
  const term = q.trim().toLowerCase();
  const shown = (videos ?? []).filter((v) => !term || v.title.toLowerCase().includes(term) || (v.category ?? "").toLowerCase().includes(term));

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4" role="dialog" aria-modal="true">
      <div className="my-6 w-full max-w-2xl rounded-2xl bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Attach from the training library</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search drills…" className="input mb-3" />
        {videos === null ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">{videos.length === 0 ? "No training videos in the library yet." : "No matches."}</p>
        ) : (
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-2">
            {shown.map((v) => (
              <button key={v.id} type="button" onClick={() => onPick(v)} className="group overflow-hidden rounded-lg border border-slate-200 text-left hover:border-brand-400 hover:shadow">
                <div className="bg-black">
                  {v.videoType === "IMAGE" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.videoUrl} alt={v.title} className="h-28 w-full object-contain" />
                  ) : (
                    <video src={v.videoUrl} preload="metadata" className="h-28 w-full object-cover" />
                  )}
                </div>
                <div className="p-2">
                  <div className="truncate text-sm font-semibold text-slate-800 group-hover:text-brand-700">{v.title}</div>
                  <div className="truncate text-xs text-slate-400">{[v.category, v.skillLevel].filter(Boolean).join(" · ")}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
