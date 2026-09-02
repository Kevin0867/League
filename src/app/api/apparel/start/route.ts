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
  if (!email || !/.+@.+\..+/.test(email)) return NextResponse.redirect(new URL("/order-apparel?err=email", origin), 303);

  // Reuse an existing adult contact by email, else create a lightweight one.
  const [firstName, ...rest] = (name || email.split("@")[0]).split(/\s+/);
  const party =
    (await prisma.person.findFirst({ where: { email, isMinor: false } })) ??
    (await prisma.person.create({ data: { firstName: firstName || "PURE", lastName: rest.join(" ") || "—", email } }));

  const payment = await prisma.payment.create({
    data: {
      direction: "IN",
      partyId: party.id,
      amountCents: 0, // set to the apparel total when the cart is saved at checkout
      method: "STRIPE",
      status: "REQUESTED",
      category: "APPAREL",
      coveredPersonIds: [party.id],
      description: "Team apparel order",
    },
  });

  return NextResponse.redirect(new URL(`/pay/${payment.id}`, origin), 303);
}
