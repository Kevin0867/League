import "server-only";
import { brandedEmailHtml } from "@/lib/email/branded";

// A weekly progress report a coach sends to a student's parent/guardian. Built
// from the week's note: what the student excelled at, what they're working on,
// and the coach's free-text message. Read-only — no CTA, just an update.

export function coachingReportEmail(opts: {
  studentFirstName: string;
  teamName: string;
  week: number;
  coachName: string;
  strengths: string[]; // human labels
  growth: string[]; // human labels
  note?: string | null;
}): { subject: string; text: string; html: string } {
  const { studentFirstName, teamName, week, coachName } = opts;
  const strengths = opts.strengths.filter(Boolean);
  const growth = opts.growth.filter(Boolean);
  const note = (opts.note ?? "").trim();

  const chip = (label: string, color: string, bg: string) =>
    `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border-radius:999px;background:${bg};color:${color};font-size:13px;font-weight:600">${label}</span>`;

  const section = (title: string, items: string[], color: string, bg: string) =>
    items.length
      ? `<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;margin-bottom:6px">${title}</div>${items.map((i) => chip(i, color, bg)).join("")}</div>`
      : "";

  const contentHtml =
    section("Excelling at", strengths, "#065f46", "#d1fae5") +
    section("Working on", growth, "#9a3412", "#ffedd5") +
    (note
      ? `<div style="margin-top:6px;border-left:3px solid #c7d2fe;padding:2px 0 2px 14px;color:#0f172a;font-size:15px;white-space:pre-line">${escapeHtml(note)}</div>`
      : "") +
    `<p style="margin:18px 0 0;font-size:13px;color:#94a3b8">— ${escapeHtml(coachName)}, ${escapeHtml(teamName)}</p>`;

  const textLines = [
    `Hi,`,
    ``,
    `Here's ${studentFirstName}'s Week ${week} progress update for ${teamName}.`,
    ``,
    strengths.length ? `Excelling at: ${strengths.join(", ")}` : "",
    growth.length ? `Working on: ${growth.join(", ")}` : "",
    note ? `\nCoach's note:\n${note}` : "",
    ``,
    `— ${coachName}, ${teamName}`,
    `PURE Academy / Arizona Club Pickleball`,
  ].filter((l) => l !== "");

  return {
    subject: `${studentFirstName}'s Week ${week} progress — ${teamName}`,
    text: textLines.join("\n"),
    html: brandedEmailHtml({
      heading: `${studentFirstName}'s Week ${week} progress`,
      intro: `A quick update from ${coachName} on how ${studentFirstName} is doing with ${teamName}.`,
      contentHtml,
    }),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
