"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { TRAINING_CATEGORIES, TRAINING_SKILL_LEVELS } from "@/lib/domain/training";

// Upload a training video to the library. The file goes straight to Vercel Blob
// (so a full-length practice clip from a phone or laptop bypasses the serverless
// body limit); once it's up we submit the metadata form, which 303-redirects
// back to the library.
export function TrainingVideoUpload({ ticket }: { ticket: string }) {
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const typeRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr("Choose a video or image to upload."); return; }
    setPct(0);
    try {
      const isVideo = file.type.startsWith("video/");
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || (isVideo ? "clip.mp4" : "image.jpg");
      const blob = await upload(`training/${Date.now()}-${safe}`, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        contentType: file.type,
        onUploadProgress: (p) => setPct(Math.round(p.percentage)),
      });
      if (urlRef.current) urlRef.current.value = blob.url;
      if (typeRef.current) typeRef.current.value = isVideo ? "VIDEO" : "IMAGE";
      formRef.current?.submit(); // native submit → 303 back to the library
    } catch (e) {
      setPct(null);
      setErr(e instanceof Error ? e.message : "Upload failed — try again.");
    }
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-primary">+ Add a training video</button>;
  }

  return (
    <form ref={formRef} method="POST" action="/api/console/training" onSubmit={onSubmit} className="card space-y-3">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="create" />
      <input type="hidden" name="returnTo" value="/console/training" />
      <input ref={urlRef} type="hidden" name="videoUrl" />
      <input ref={typeRef} type="hidden" name="videoType" value="VIDEO" />

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-brand-800">Add a training video</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
      </div>

      <div>
        <label className="label">Title *</label>
        <input name="title" className="input" placeholder="e.g. Third-shot drop — soft hands drill" required />
      </div>
      <div>
        <label className="label">Description</label>
        <textarea name="description" rows={2} className="input" placeholder="What it covers, cues to watch for, how to practice it…" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Category</label>
          <select name="category" className="input" defaultValue="">
            <option value="">— choose —</option>
            {TRAINING_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Skill level</label>
          <select name="skillLevel" className="input" defaultValue="">
            <option value="">— choose —</option>
            {TRAINING_SKILL_LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Video (or image)</label>
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
          capture={undefined}
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          className="block w-full text-xs sm:text-sm"
        />
        <p className="mt-1 text-xs text-slate-400">Records or uploads from your phone or computer. Up to 500&nbsp;MB.</p>
        {fileName && <p className="mt-1 text-xs text-slate-500">Selected: {fileName}</p>}
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="visibleToPlayers" value="1" className="mt-0.5 accent-brand-600" />
        Share with players (they&apos;ll see it in their portal — good for homework)
      </label>

      {err && <p className="text-xs text-rose-600">{err}</p>}
      {pct !== null && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost text-sm" disabled={pct !== null}>Cancel</button>
        <button type="submit" className="btn-primary text-sm" disabled={pct !== null}>
          {pct !== null ? `Uploading… ${pct}%` : "Add to library"}
        </button>
      </div>
    </form>
  );
}
