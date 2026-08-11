import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/notify";

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

  // Confirmation stating the dates plainly.
  await sendEmail(
    email,
    "Arizona Club Pickleball — you're on the list",
    `Thanks, ${contactName} — ${clubName} is on the Arizona Club Pickleball interest list.\n\n` +
      `Here are the dates:\n` +
      `• Entries open: September 14, 2026\n` +
      `• Entries close: October 12, 2026\n` +
      `• League begins: the week of October 26, 2026\n\n` +
      `We'll email you the moment entries open so you can enter your team. Questions? Just reply to this email.\n\n— PURE Academy / Arizona Club Pickleball`,
  );

  return back("?ok=1");
}
