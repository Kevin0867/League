import "server-only";
import { brandedEmailHtml } from "@/lib/email/branded";

// A coach's team update, emailed to the whole team (players + parents). Plain
// message, no CTA — "today we worked on X, please work on your third-shot drop
// this week," and so on.
export function teamUpdateEmail(opts: {
  teamName: string;
  coachName: string;
  body: string;
  /** Optional photo/video attachment (Vercel Blob URL) + its kind (IMAGE|VIDEO).
   *  A photo is embedded inline; a video can't play in email, so it's a link. */
  attachmentUrl?: string | null;
  attachmentType?: string | null;
}): {
  subject: string;
  text: string;
  html: string;
} {
  const body = opts.body.trim();
  // The attachment: a video gets a big "watch" button (email can't play video);
  // a photo is embedded and also linked so it opens full-size.
  let attachHtml = "";
  let attachText = "";
  if (opts.attachmentUrl) {
    const url = opts.attachmentUrl;
    if (opts.attachmentType === "VIDEO") {
      attachHtml = `<p style="margin:18px 0 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#059669;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:12px 20px;border-radius:10px">▶ Watch the video</a></p>`;
      attachText = `\nWatch the video: ${url}`;
    } else {
      attachHtml = `<p style="margin:18px 0 0"><a href="${escapeHtml(url)}"><img src="${escapeHtml(url)}" alt="attachment" style="max-width:100%;border-radius:10px" /></a></p>`;
      attachText = `\nView the photo: ${url}`;
    }
  }
  const contentHtml =
    `<div style="white-space:pre-line;font-size:15px;line-height:1.5;color:#0f172a">${escapeHtml(body)}</div>` +
    attachHtml +
    `<p style="margin:18px 0 0;font-size:13px;color:#94a3b8">— ${escapeHtml(opts.coachName)}, ${escapeHtml(opts.teamName)}</p>`;
  const text = [body, attachText, "", `— ${opts.coachName}, ${opts.teamName}`, "PURE Academy"].filter(Boolean).join("\n");
  return {
    subject: `Update from ${opts.teamName}`,
    text,
    html: brandedEmailHtml({
      heading: `Update from ${opts.teamName}`,
      intro: `A note from ${opts.coachName}`,
      contentHtml,
    }),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
