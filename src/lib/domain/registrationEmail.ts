import "server-only";
import { sendEmail } from "@/lib/notify";
import { brandedEmailHtml } from "@/lib/email/branded";
import { SUPPORT_EMAIL } from "@/lib/payments/receipt";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type EnrolledPlayer = { name: string; program: string };

export type RegistrationSummary = {
  toEmail: string;
  recipientName: string;
  seasonName: string;
  players: EnrolledPlayer[];
  locations: string[];
  practiceTimes: string[];
};

function playerRows(players: EnrolledPlayer[]): string {
  return players
    .map(
      (p) =>
        `<tr><td style="padding:6px 0;color:#0f172a;font-weight:600">${p.name}</td>` +
        `<td style="padding:6px 0;color:#64748b;text-align:right">${p.program || "Placement TBD"}</td></tr>`
    )
    .join("");
}

/** Confirmation to the registrant summarizing who was enrolled and preferences. */
export async function sendRegistrationConfirmation(s: RegistrationSummary) {
  const prefs: string[] = [];
  if (s.locations.length) prefs.push(`Locations: ${s.locations.join(", ")}`);
  if (s.practiceTimes.length) prefs.push(`Practice times: ${s.practiceTimes.join(", ")}`);

  const contentHtml =
    `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px">` +
    `<table style="width:100%;border-collapse:collapse">${playerRows(s.players)}</table>` +
    (prefs.length
      ? `<p style="margin:12px 0 0;font-size:13px;color:#64748b">${prefs.join(" &nbsp;·&nbsp; ")}</p>`
      : "") +
    `</div>` +
    `<p style="margin:16px 0 0;font-size:14px;color:#475569">Our team is matching ${
      s.players.length > 1 ? "each player" : "you"
    } to the right team, coach, and location, and we'll reach out to confirm. ` +
    `Enroll today, pay later — no payment is due until placement is set.</p>`;

  const text = [
    `Thanks, ${s.recipientName}! We received your ${s.seasonName} registration.`,
    ``,
    ...s.players.map((p) => `  - ${p.name}${p.program ? ` — ${p.program}` : ""}`),
    ``,
    ...prefs,
    ``,
    `Our team will match placement and reach out to confirm. No payment is due yet.`,
    `Any issues, contact us at ${SUPPORT_EMAIL}.`,
  ].join("\n");

  return sendEmail(
    s.toEmail,
    `We received your ${s.seasonName} registration`,
    text,
    brandedEmailHtml({
      heading: `Thanks, ${s.recipientName}!`,
      intro: `We received your ${s.seasonName} registration. Here's what you signed up for.`,
      contentHtml,
    })
  );
}

/** Internal heads-up to the team inbox that a new registration came in. */
export async function notifyTeamOfRegistration(s: RegistrationSummary) {
  const lines = [
    `New ${s.seasonName} registration from ${s.recipientName} (${s.toEmail}).`,
    ``,
    ...s.players.map((p) => `  - ${p.name}${p.program ? ` — ${p.program}` : ""}`),
    ``,
    s.locations.length ? `Locations: ${s.locations.join(", ")}` : "",
    s.practiceTimes.length ? `Practice times: ${s.practiceTimes.join(", ")}` : "",
  ].filter(Boolean);

  const contentHtml =
    `<p style="margin:0 0 8px;font-size:14px;color:#475569">Contact: ${esc(s.recipientName)} — ${esc(s.toEmail)}</p>` +
    `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px">` +
    `<table style="width:100%;border-collapse:collapse">${playerRows(s.players)}</table>` +
    ((s.locations.length || s.practiceTimes.length)
      ? `<p style="margin:10px 0 0;font-size:13px;color:#64748b">` +
        [s.locations.length ? `Locations: ${esc(s.locations.join(", "))}` : "", s.practiceTimes.length ? `Practice: ${esc(s.practiceTimes.join(", "))}` : ""]
          .filter(Boolean)
          .join(" &nbsp;·&nbsp; ") +
        `</p>`
      : "") +
    `</div>`;

  return sendEmail(
    SUPPORT_EMAIL,
    `New registration — ${s.recipientName}`,
    lines.join("\n"),
    brandedEmailHtml({ heading: "New registration", intro: `${s.seasonName}`, contentHtml })
  );
}
