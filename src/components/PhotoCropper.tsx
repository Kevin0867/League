"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A dependency-free photo cropper: the user drags to reposition and uses the
// zoom slider, then Save exports the visible crop to a JPEG at the display's
// aspect ratio. Used before uploading profile/coach photos so headshots frame
// cleanly instead of being top-cropped by the card.
export function PhotoCropper({
  file,
  aspect,
  outputWidth = 1000,
  onDone,
  onCancel,
}: {
  file: File;
  /** width / height of the crop (e.g. 4/3 to match the coach card). */
  aspect: number;
  outputWidth?: number;
  onDone: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [vp, setVp] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // Load the file into an object URL.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Measure the viewport (fixed aspect) so all math is in real pixels.
  useEffect(() => {
    const measure = () => {
      const w = vpRef.current?.clientWidth ?? 0;
      setVp({ w, h: w / aspect });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [aspect, src]);

  // Cover scale so the image fills the viewport at zoom=1.
  const baseScale = nat && vp.w ? Math.max(vp.w / nat.w, vp.h / nat.h) : 1;
  const scale = baseScale * zoom;

  // Keep the image covering the viewport (no empty gaps at the edges).
  const clamp = useCallback(
    (p: { x: number; y: number }, s: number) => {
      if (!nat) return p;
      const maxX = Math.max(0, (nat.w * s - vp.w) / 2);
      const maxY = Math.max(0, (nat.h * s - vp.h) / 2);
      return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) };
    },
    [nat, vp.w, vp.h]
  );

  useEffect(() => setPos((p) => clamp(p, scale)), [scale, clamp]);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const nx = drag.current.ox + (e.clientX - drag.current.px);
    const ny = drag.current.oy + (e.clientY - drag.current.py);
    setPos(clamp({ x: nx, y: ny }, scale));
  }
  function onPointerUp() {
    drag.current = null;
  }

  async function save() {
    if (!nat || !imgRef.current || !vp.w) return;
    setBusy(true);
    try {
      // Source rect currently shown in the viewport.
      const swv = vp.w / scale;
      const shv = vp.h / scale;
      const cx = nat.w / 2 - pos.x / scale; // source point at viewport center
      const cy = nat.h / 2 - pos.y / scale;
      const sx = Math.max(0, cx - swv / 2);
      const sy = Math.max(0, cy - shv / 2);

      const outW = outputWidth;
      const outH = Math.round(outputWidth / aspect);
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no ctx");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(imgRef.current, sx, sy, swv, shv, 0, 0, outW, outH);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
      if (blob) onDone(blob);
    } finally {
      setBusy(false);
    }
  }

  // Preview position: image center sits at viewport center + pos.
  const imgStyle: React.CSSProperties = nat && vp.w
    ? {
        position: "absolute",
        width: nat.w * scale,
        height: nat.h * scale,
        left: vp.w / 2 - (nat.w * scale) / 2 + pos.x,
        top: vp.h / 2 - (nat.h * scale) / 2 + pos.y,
        maxWidth: "none",
        userSelect: "none",
        touchAction: "none",
      }
    : { display: "none" };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl">
        <h3 className="mb-1 text-sm font-bold text-slate-900">Position &amp; crop photo</h3>
        <p className="mb-3 text-xs text-slate-500">Drag to move, use the slider to zoom, then Save.</p>
        <div
          ref={vpRef}
          className="relative w-full overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200"
          style={{ aspectRatio: String(aspect), cursor: "grab", touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={src}
              alt="Crop preview"
              draggable={false}
              onLoad={(e) => {
                const im = e.currentTarget;
                setNat({ w: im.naturalWidth, h: im.naturalHeight });
              }}
              style={imgStyle}
            />
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-slate-400">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="flex-1 accent-brand-600"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost text-sm" disabled={busy}>Cancel</button>
          <button type="button" onClick={save} className="btn-primary text-sm" disabled={busy || !nat}>{busy ? "Saving…" : "Save photo"}</button>
        </div>
      </div>
    </div>
  );
}
