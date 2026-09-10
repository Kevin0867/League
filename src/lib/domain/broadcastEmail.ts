import "server-only";
import { brandedEmailHtml } from "@/lib/email/branded";

// Branded HTML for a broadcast/announcement that carries a photo or video.
// A photo is embedded inline (and linked full-size); a video can't play in
// email, so it becomes a "Watch the video" button. Mirrors teamUpdateEmail so
// every messaging surface embeds media the same way.
export function broadcastEmailHtml(opts: {
  subject?: string;
  body: string;
  attachmentUrl: string;
  attachmentType?: string | null;
}): string {
  const body = opts.body.trim();
  const url = opts.attachmentUrl;
  const attachHtml =
    opts.attachmentType === "VIDEO"
      ? `<p style="margin:18px 0 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#059669;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:12px 20px;border-radius:10px">▶ Watch the video</a></p>`
      : `<p style="margin:18px 0 0"><a href="${escapeHtml(url)}"><img src="${escapeHtml(url)}" alt="attachment" style="max-width:100%;border-radius:10px" /></a></p>`;
  const contentHtml =
    `<div style="white-space:pre-line;font-size:15px;line-height:1.5;color:#0f172a">${escapeHtml(body)}</div>` + attachHtml;
  return brandedEmailHtml({ heading: opts.subject || "PURE Academy", contentHtml });
}

// SMS text for a broadcast with an attachment — include the link so texted
// recipients can open the photo/video too.
export function broadcastSmsWithMedia(opts: { subject?: string; body: string; attachmentUrl: string; attachmentType?: string | null }): string {
  const head = opts.subject ? `${opts.subject}\n` : "";
  const label = opts.attachmentType === "VIDEO" ? "Video" : "Photo";
  return `${head}${opts.body}\n${label}: ${opts.attachmentUrl}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
