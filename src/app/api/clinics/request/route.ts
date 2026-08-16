import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/notify";
import { brandedEmailHtml } from "@/lib/email/branded";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TYPE_LABEL: Record<string, string> = {
  PRIVATE: "Private lesson (1-on-1)",
  SEMI_PRIVATE: "Semi-private (2–3 players)",
  CLINIC: "Group clinic",
  UNSURE: "Not sure yet",
};

// Public lesson/clinic request (no auth). Saves the request, emails the ops
// inbox so it lands in front of the team, and sends the requester a branded
// confirmation.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/clinics/request${qs}`, origin), 303);

  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const phone = String(form.get("phone") ?? "").trim() || null;
  const requestTypeRaw = String(form.get("requestType") ?? "UNSURE").trim();
  const requestType = TYPE_LABEL[requestTypeRaw] ? requestTypeRaw : "UNSURE";
  const skillLevel = String(form.get("skillLevel") ?? "").trim() || null;
  const locations = String(form.get("locations") ?? "").trim() || null;
  const preferredTimes = String(form.get("preferredTimes") ?? "").trim() || null;
  const notes = String(form.get("notes") ?? "").trim() || null;

  if (!name || !email || !/.+@.+\..+/.test(email)) return back("?err=fields");

  await prisma.lessonRequest.create({
    data: { name, email, phone, requestType, skillLevel, locations, preferredTimes, notes },
  });

  const typeLabel = TYPE_LABEL[requestType];
  const opsEmail = process.env.OPS_EMAIL ?? "team@purepickleball.com";
  await sendEmail(
    opsEmail,
    `New lesson/clinic request — ${name}`,
    `A new lesson/clinic request was submitted:\n\n` +
      `• Name: ${name}\n` +
      `• Email: ${email}\n` +
      `• Phone: ${phone ?? "—"}\n` +
      `• Looking for: ${typeLabel}\n` +
      `• Skill level: ${skillLevel ?? "—"}\n` +
      `• Preferred locations: ${locations ?? "—"}\n` +
      `• Preferred times: ${preferredTimes ?? "—"}\n` +
      `• Notes: ${notes ?? "—"}\n\n` +
      `Follow up soon — reply directly to ${email}.`,
  );

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#64748b;font-size:14px;width:150px">${label}</td>` +
    `<td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600">${value}</td></tr>`;
  const text =
    `Thanks, ${name} — we got your request for coaching with PURE Academy.\n\n` +
    `What you asked for: ${typeLabel}\n` +
    (skillLevel ? `Skill level: ${skillLevel}\n` : "") +
    (locations ? `Preferred locations: ${locations}\n` : "") +
    (preferredTimes ? `Preferred times: ${preferredTimes}\n` : "") +
    `\nA member of our team will reach out to match you with a coach and set up a time. Questions? Just reply to this email.\n\n— PURE Academy`;
  const html = brandedEmailHtml({
    heading: "Request received!",
    intro: `Thanks, ${esc(name)} — we've got your request and a coach coordinator will be in touch soon.`,
    contentHtml:
      `<p style="margin:0 0 12px;color:#334155;font-size:15px">Here's what you told us:</p>` +
      `<table style="width:100%;border-collapse:collapse;margin:0 0 16px">` +
      row("Looking for", esc(typeLabel)) +
      (skillLevel ? row("Skill level", esc(skillLevel)) : "") +
      (locations ? row("Locations", esc(locations)) : "") +
      (preferredTimes ? row("Preferred times", esc(preferredTimes)) : "") +
      `</table>` +
      `<p style="margin:0;color:#475569;font-size:14px">We'll reach out to match you with the right coach and set up a time. Questions? Just reply to this email.</p>`,
  });
  await sendEmail(email, "PURE Academy — we got your coaching request", text, html);

  return back("?ok=1");
}
