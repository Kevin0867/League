import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/notify";
import { formatCents } from "@/lib/money";
import { acpEntryWindow, validateEntry, type RosterPlayerInput } from "@/lib/domain/acpEntry";

// Phase-B ACP entry submission (build-list item 1). Public, no auth — an outside
// club enters one team into one division with a 6–8 player roster. Validates the
// roster size and (for adult divisions) DUPR band eligibility, records the entry
// + fee, and emails the team contact.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/acp/enter${qs}`, origin), 303);

  // Reject outside the entry window even if someone posts directly.
  if (acpEntryWindow() !== "open") return back("");

  const form = await req.formData();
  const clubName = String(form.get("clubName") ?? "").trim();
  const market = String(form.get("market") ?? "").trim() || null;
  const divisionName = String(form.get("divisionName") ?? "").trim();
  const contactName = String(form.get("contactName") ?? "").trim();
  const contactEmail = String(form.get("contactEmail") ?? "").trim().toLowerCase();
  const contactPhone = String(form.get("contactPhone") ?? "").trim() || null;

  if (!clubName) return back("?err=club");
  if (!contactName || !contactEmail || !/.+@.+\..+/.test(contactEmail)) return back("?err=contact");
  if (!divisionName) return back("?err=division");

  // Roster arrives as parallel repeated fields.
  const names = form.getAll("playerName").map((v) => String(v));
  const emails = form.getAll("playerEmail").map((v) => String(v));
  const duprs = form.getAll("playerDupr").map((v) => String(v));
  const players: RosterPlayerInput[] = names.map((name, i) => {
    const ratingRaw = (duprs[i] ?? "").trim();
    const rating = ratingRaw ? parseFloat(ratingRaw) : null;
    return {
      name,
      email: emails[i] ?? null,
      duprRating: rating != null && Number.isFinite(rating) ? rating : null,
    };
  });

  const v = validateEntry({ divisionName, players });
  if (!v.ok) return back(`?err=roster&detail=${encodeURIComponent(v.error)}`);

  const season = await prisma.season.findFirst({ where: { active: true, program: "ACP" } });

  await prisma.acpEntry.create({
    data: {
      seasonId: season?.id ?? null,
      clubName,
      market,
      divisionName,
      divisionCode: v.divisionCode,
      contactName,
      contactEmail,
      contactPhone,
      playerCount: v.players.length,
      amountDueCents: v.amountCents,
      status: "SUBMITTED",
      players: {
        create: v.players.map((p) => ({
          name: p.name,
          email: p.email ?? null,
          duprId: p.duprId ?? null,
          duprRating: p.duprRating ?? null,
        })),
      },
    },
  });

  await sendEmail(
    contactEmail,
    "Arizona Club Pickleball — entry received",
    `Thanks, ${contactName} — we've received ${clubName}'s entry into ${divisionName}.\n\n` +
      `Roster: ${v.players.length} players\n` +
      `Amount due: ${formatCents(v.amountCents)} ($195 per player)\n\n` +
      `We'll email a secure payment link shortly. Your place is confirmed once payment clears.\n\n` +
      `A note on divisions: each runs with a minimum of four teams. If your division is short, we'll reach out ` +
      `about consolidating with an adjacent band before the league begins the week of October 26.\n\n` +
      `Questions? Just reply to this email.\n\n— PURE Academy / Arizona Club Pickleball`,
  );

  return back("?ok=1");
}
