import "server-only";
import { brandedEmailHtml } from "@/lib/email/branded";

// A coach's team update, emailed to the whole team (players + parents). Plain
// message, no CTA — "today we worked on X, please work on your third-shot drop
// this week," and so on.
export function teamUpdateEmail(opts: { teamName: string; coachName: string; body: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const body = opts.body.trim();
  const contentHtml =
    `<div style="white-space:pre-line;font-size:15px;line-height:1.5;color:#0f172a">${escapeHtml(body)}</div>` +
    `<p style="margin:18px 0 0;font-size:13px;color:#94a3b8">— ${escapeHtml(opts.coachName)}, ${escapeHtml(opts.teamName)}</p>`;
  const text = [body, "", `— ${opts.coachName}, ${opts.teamName}`, "PURE Academy"].join("\n");
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
