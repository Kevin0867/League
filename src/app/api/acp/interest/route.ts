import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/notify";
import { brandedEmailHtml } from "@/lib/email/branded";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Phase-A ACP interest capture (build-list item 1). Public, no auth — an outside
// club registers interest before entries open on September 14.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/acp${qs}`, origin), 303);

  const form = await req.formData();
  const clubName = String(form.get("clubName") ?? "").trim();
  const contactName = String(form.get("contactName") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const phone = String(form.get("phone") ?? "").trim() || null;
  const market = String(form.get("market") ?? "").trim() || null;
  const likelyTeamsRaw = String(form.get("likelyTeams") ?? "").trim();
  const likelyTeams = likelyTeamsRaw ? parseInt(likelyTeamsRaw, 10) : null;
  const likelyDivisions = String(form.get("likelyDivisions") ?? "").trim() || null;

  if (!clubName || !contactName || !email || !/.+@.+\..+/.test(email)) return back("?err=fields");

  await prisma.acpInterest.create({
    data: { clubName, contactName, email, phone, market, likelyTeams: Number.isFinite(likelyTeams as number) ? likelyTeams : null, likelyDivisions },
  });

  // Notify the team so a new interest lands in the inbox, not just the console.
  const opsEmail = process.env.OPS_EMAIL ?? "team@purepickleball.com";
  await sendEmail(
    opsEmail,
    `New ACP interest — ${clubName}`,
    `A new Arizona Club Pickleball interest was submitted:\n\n` +
      `• Club: ${clubName}\n` +
      `• Contact: ${contactName}\n` +
      `• Email: ${email}\n` +
      `• Phone: ${phone ?? "—"}\n` +
      `• Market/city: ${market ?? "—"}\n` +
      `• Likely # of teams: ${likelyTeams ?? "—"}\n` +
      `• Division: ${likelyDivisions ?? "—"}\n\n` +
      `See all entries: ${origin}/console/acp`,
  );

  // Branded HTML confirmation (PURE Academy logo top-left, PURE Pickleball &
  // Padel top-right) with a plain-text fallback for non-HTML clients.
  const text =
    `Thanks, ${contactName} — ${clubName} is on the Arizona Club Pickleball interest list.\n\n` +
    `Here are the dates:\n` +
    `• Entries open: September 14, 2026\n` +
    `• Entries close: October 12, 2026\n` +
    `• League begins: the week of October 26, 2026\n\n` +
    `We'll email you the moment entries open so you can enter your team. Questions? Just reply to this email.\n\n— PURE Academy / Arizona Club Pickleball`;

  const dateRow = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#64748b;font-size:14px;width:130px">${label}</td>` +
    `<td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600">${value}</td></tr>`;
  const html = brandedEmailHtml({
    heading: "You're on the list!",
    intro: `Thanks, ${esc(contactName)} — ${esc(clubName)} is on the Arizona Club Pickleball interest list.`,
    contentHtml:
      `<p style="margin:0 0 12px;color:#334155;font-size:15px">Here are the key dates:</p>` +
      `<table style="width:100%;border-collapse:collapse;margin:0 0 16px">` +
      dateRow("Entries open", "September 14, 2026") +
      dateRow("Entries close", "October 12, 2026") +
      dateRow("League begins", "the week of October 26, 2026") +
      `</table>` +
      `<p style="margin:0;color:#475569;font-size:14px">We'll email you the moment entries open so you can enter your team. Questions? Just reply to this email.</p>`,
  });

  await sendEmail(email, "Arizona Club Pickleball — you're on the list", text, html);

  return back("?ok=1");
}
