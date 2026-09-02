import "server-only";
import { sendEmail } from "@/lib/notify";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { SUPPORT_EMAIL, SUPPORT_ADDRESS } from "@/lib/payments/receipt";
import { appUrl } from "@/lib/stripe";

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
  /** True when the registration deadline has passed — the registrant is on the
   *  waitlist, and the confirmation says so. */
  waitlisted?: boolean;
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

/** Pure builder for the registrant confirmation — returns {subject, text, html}
 *  so it can be sent OR unit-tested without a mail provider. */
export function registrationConfirmationContent(s: RegistrationSummary): { subject: string; text: string; html: string } {
  const prefs: string[] = [];
  if (s.locations.length) prefs.push(`Locations: ${s.locations.join(", ")}`);
  if (s.practiceTimes.length) prefs.push(`Practice times: ${s.practiceTimes.join(", ")}`);

  const wl = !!s.waitlisted;
  const waitBanner = wl
    ? `<div style="border:1px solid #fcd34d;background:#fffbeb;border-radius:10px;padding:12px 16px;margin-bottom:14px">` +
      `<p style="margin:0;font-size:14px;color:#92400e"><strong>Registration for ${esc(s.seasonName)} has closed.</strong> ` +
      `You're on the <strong>waitlist</strong> — we'll be in touch if a spot opens up. No payment is due unless you're placed.</p></div>`
    : "";
  const followUp = wl
    ? `<p style="margin:16px 0 12px;font-size:14px;color:#475569">We've added ${
        s.players.length > 1 ? "each player" : "you"
      } to the waitlist and will reach out if space becomes available. There's nothing more to do for now, and no payment is due unless a spot opens and you're placed.</p>`
    : `<p style="margin:16px 0 12px;font-size:14px;color:#475569">Our team is matching ${
        s.players.length > 1 ? "each player" : "you"
      } to the right team, coach, and location, and we'll reach out to confirm. ` +
      `Enroll today, pay later — no payment is due until placement is set. ` +
      `We'll email your team placement and, separately, a secure link to pay the season fee.</p>`;

  const contentHtml =
    waitBanner +
    `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px">` +
    `<table style="width:100%;border-collapse:collapse">${playerRows(s.players)}</table>` +
    (prefs.length
      ? `<p style="margin:12px 0 0;font-size:13px;color:#64748b">${prefs.join(" &nbsp;·&nbsp; ")}</p>`
      : "") +
    `</div>` +
    followUp +
    emailButton(`${appUrl()}/programs`, "Explore PURE Academy programs", { primary: true });

  const text = [
    wl
      ? `Thanks, ${s.recipientName}! Registration for ${s.seasonName} has closed, so you've been added to the WAITLIST.`
      : `Thanks, ${s.recipientName}! We received your ${s.seasonName} registration.`,
    ``,
    ...s.players.map((p) => `  - ${p.name}${p.program ? ` — ${p.program}` : ""}`),
    ``,
    ...prefs,
    ``,
    wl
      ? `We'll reach out if a spot opens up. No payment is due unless you're placed.`
      : `Our team will match placement and reach out to confirm. No payment is due yet.\nWe'll email your team placement and a secure link to pay the season fee.`,
    ``,
    `Explore PURE Academy programs: ${appUrl()}/programs`,
    `Any issues, contact us at ${SUPPORT_ADDRESS}.`,
  ].join("\n");

  return {
    subject: wl ? `You're on the ${s.seasonName} waitlist` : `We received your ${s.seasonName} registration`,
    text,
    html: brandedEmailHtml({
      heading: wl ? `You're on the waitlist, ${s.recipientName}` : `Thanks, ${s.recipientName}!`,
      intro: wl
        ? `Registration for ${s.seasonName} has closed, so we've added you to the waitlist.`
        : `We received your ${s.seasonName} registration. Here's what you signed up for.`,
      contentHtml,
    }),
  };
}

/** Confirmation to the registrant summarizing who was enrolled and preferences. */
export async function sendRegistrationConfirmation(s: RegistrationSummary) {
  const c = registrationConfirmationContent(s);
  return sendEmail(s.toEmail, c.subject, c.text, c.html);
}

/** Internal heads-up to the team inbox that a new registration came in. When the
 *  registrant landed on the waitlist (registration closed / waitlist mode on),
 *  the notice says so up top so staff triage it as a waitlist add, not a
 *  to-be-placed signup. */
export async function notifyTeamOfRegistration(s: RegistrationSummary) {
  const wl = !!s.waitlisted;
  const lines = [
    wl
      ? `WAITLIST — new ${s.seasonName} waitlist signup from ${s.recipientName} (${s.toEmail}).`
      : `New ${s.seasonName} registration from ${s.recipientName} (${s.toEmail}).`,
    ``,
    ...s.players.map((p) => `  - ${p.name}${p.program ? ` — ${p.program}` : ""}`),
    ``,
    s.locations.length ? `Locations: ${s.locations.join(", ")}` : "",
    s.practiceTimes.length ? `Practice times: ${s.practiceTimes.join(", ")}` : "",
  ].filter(Boolean);

  const waitBanner = wl
    ? `<div style="border:1px solid #fcd34d;background:#fffbeb;border-radius:10px;padding:10px 14px;margin-bottom:12px">` +
      `<p style="margin:0;font-size:13px;color:#92400e"><strong>On the waitlist.</strong> Registration is closed, so this signup was filed as WAITLISTED — no payment was requested.</p></div>`
    : "";

  const contentHtml =
    waitBanner +
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
    wl ? `Waitlist signup — ${s.recipientName}` : `New registration — ${s.recipientName}`,
    lines.join("\n"),
    brandedEmailHtml({ heading: wl ? "New waitlist signup" : "New registration", intro: `${s.seasonName}`, contentHtml })
  );
}
