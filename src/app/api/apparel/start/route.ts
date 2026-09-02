import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// PUBLIC — starts a standalone team-apparel order. Collects only a name + email,
// creates an apparel-only Payment, and sends the buyer to the public pay page
// where they pick items and check out. No login, no fixed amount (the apparel
// they choose IS the charge). The payment id in the resulting URL is the
// capability token, exactly like the season-fee pay link.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const playerName = String(form.get("playerName") ?? "").trim();
  const teamId = String(form.get("teamId") ?? "").trim() || null;
  if (!email || !/.+@.+\..+/.test(email)) return NextResponse.redirect(new URL("/order-apparel?err=email", origin), 303);

  // Validate the chosen team belongs to the live season and isn't a test team.
  const team = teamId
    ? await prisma.team.findFirst({ where: { id: teamId, isTest: false }, select: { id: true, name: true } }).catch(() => null)
    : null;

  // Reuse an existing adult contact by email (the buyer / paying adult), else
  // create a lightweight one.
  const [bFirst, ...bRest] = (name || email.split("@")[0]).split(/\s+/);
  const buyer =
    (await prisma.person.findFirst({ where: { email, isMinor: false } })) ??
    (await prisma.person.create({ data: { firstName: bFirst || "PURE", lastName: bRest.join(" ") || "—", email } }));

  // The gear is FOR the named player. Tag the order to a player record so the
  // fulfillment report shows a name; reuse the buyer when no separate player is
  // named or it's the same person.
  let coveredPersonId = buyer.id;
  if (playerName && playerName.toLowerCase() !== `${buyer.firstName} ${buyer.lastName}`.trim().toLowerCase()) {
    const [pFirst, ...pRest] = playerName.split(/\s+/);
    const player = await prisma.person.create({
      data: { firstName: pFirst, lastName: pRest.join(" ") || "—", guardianId: buyer.id, email2: email, email2Label: "Parent/guardian" },
    });
    coveredPersonId = player.id;
  }

  const who = playerName || `${buyer.firstName} ${buyer.lastName}`.trim();
  const payment = await prisma.payment.create({
    data: {
      direction: "IN",
      partyId: buyer.id,
      amountCents: 0, // set to the apparel total when the cart is saved at checkout
      method: "STRIPE",
      status: "REQUESTED",
      category: "APPAREL",
      apparelTeamId: team?.id ?? null,
      coveredPersonIds: [coveredPersonId],
      description: `Team apparel order — ${who}${team ? ` · ${team.name}` : ""}`,
    },
  });

  return NextResponse.redirect(new URL(`/pay/${payment.id}`, origin), 303);
}
