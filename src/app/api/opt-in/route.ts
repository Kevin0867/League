import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CONSENT_VERSION, consentRecordText } from "@/lib/consent";

// Public messaging opt-in (build: express email/SMS consent). Stores an
// auditable consent record and, if the person is already known, stamps their
// consent timestamps. This endpoint + the /opt-in page are the proof of opt-in
// submitted to Twilio for A2P 10DLC.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/opt-in${qs}`, origin), 303);

  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase() || null;
  const phone = String(form.get("phone") ?? "").trim() || null;
  const emailOptIn = form.get("emailOptIn") === "on";
  const smsOptIn = form.get("smsOptIn") === "on";

  if (!name) return back("?err=name");
  if (!emailOptIn && !smsOptIn) return back("?err=none");
  if (emailOptIn && (!email || !/.+@.+\..+/.test(email))) return back("?err=email");
  if (smsOptIn && (!phone || phone.replace(/\D/g, "").length < 10)) return back("?err=phone");

  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  // Match an existing person by email or phone (don't mint phantom records).
  const person =
    (email ? await prisma.person.findFirst({ where: { email } }) : null) ??
    (phone ? await prisma.person.findFirst({ where: { phone } }) : null);

  await prisma.messagingConsent.create({
    data: {
      personId: person?.id ?? null,
      name,
      email,
      phone,
      emailOptIn,
      smsOptIn,
      consentText: consentRecordText(emailOptIn, smsOptIn),
      consentVersion: CONSENT_VERSION,
      source: "opt-in-form",
      ipAddress,
      userAgent,
    },
  });

  if (person) {
    const now = new Date();
    await prisma.person.update({
      where: { id: person.id },
      data: {
        ...(emailOptIn ? { emailConsentAt: now } : {}),
        ...(smsOptIn ? { smsConsentAt: now } : {}),
      },
    });
  }

  return back("?ok=1");
}
