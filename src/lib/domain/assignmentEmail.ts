import "server-only";
import { appUrl } from "@/lib/stripe";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { SUPPORT_ADDRESS } from "@/lib/payments/receipt";

// Branded team-assignment email: team, coach, location + address, practice
// day/time, and a button to view the full team (coach info + teammates).

export type AssignmentDetail = {
  name: string;
  teamId: string;
  teamName: string;
  coachName: string;
  coachContact?: string | null;
  locationName: string;
  locationAddress?: string | null;
  practiceWhen: string;
};

function row(label: string, value: string): string {
  return (
    `<tr>` +
    `<td style="padding:7px 0;color:#64748b;font-size:13px;vertical-align:top;width:34%">${label}</td>` +
    `<td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600">${value}</td>` +
    `</tr>`
  );
}

export function teamAssignmentEmail(d: AssignmentDetail): {
  subject: string;
  text: string;
  html: string;
} {
  const base = appUrl();
  const teamUrl = `${base}/portal/team/${d.teamId}`;

  const rows = [
    row("Team", d.teamName),
    row("Coach", d.coachContact ? `${d.coachName}<br><span style="font-weight:400;color:#64748b;font-size:13px">${d.coachContact}</span>` : d.coachName),
    row("Location", d.locationAddress ? `${d.locationName}<br><span style="font-weight:400;color:#64748b;font-size:13px">${d.locationAddress}</span>` : d.locationName),
    row("Practice", d.practiceWhen),
  ].join("");

  const contentHtml =
    `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:6px 16px;margin-bottom:16px">` +
    `<table style="width:100%;border-collapse:collapse">${rows}</table>` +
    `</div>` +
    emailButton(teamUrl, "View your team", { primary: true }) +
    `<p style="margin:14px 0 0;font-size:13px;color:#475569">See your coach's info, your teammates, and practice details in your portal. ` +
    `Your season fee request will follow shortly.</p>`;

  const text = [
    `Great news, ${d.name} — you're on ${d.teamName}!`,
    ``,
    `Coach: ${d.coachName}${d.coachContact ? ` (${d.coachContact})` : ""}`,
    `Location: ${d.locationName}${d.locationAddress ? ` — ${d.locationAddress}` : ""}`,
    `Practice: ${d.practiceWhen}`,
    ``,
    `View your team (coach info + teammates): ${teamUrl}`,
    `Your season fee request will follow shortly.`,
    ``,
    `Any issues, contact us at ${SUPPORT_ADDRESS}.`,
  ].join("\n");

  return {
    subject: `You're on ${d.teamName}!`,
    text,
    html: brandedEmailHtml({
      heading: `You're on ${d.teamName}!`,
      intro: `Great news, ${d.name} — here are your team details.`,
      contentHtml,
    }),
  };
}
