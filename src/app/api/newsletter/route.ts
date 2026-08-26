import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CONSENT_VERSION, consentRecordText } from "@/lib/consent";
import { pushContactToZoho } from "@/lib/integrations/zoho";

// First-party newsletter signup (replaces the brittle embedded Zoho web-optin
// that showed a 404 on submit). Records an auditable consent, then subscribes
// the contact to the Zoho Campaigns list server-side — no captcha, no iframe,
// no third-party redirect. Returns JSON so the footer form can show an inline
// thank-you without navigating.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const str = (k: string) => String(body[k] ?? "").trim();
  const firstName = str("firstName");
  const lastName = str("lastName");
  const email = str("email").toLowerCase() || null;
  const phone = str("phone") || null;
  const consent = body.consent === true || body.consent === "on";

  if (!email || !/.+@.+\..+/.test(email)) return NextResponse.json({ ok: false, error: "Please enter a valid email address." }, { status: 400 });
  if (!consent) return NextResponse.json({ ok: false, error: "Please agree to receive communications to subscribe." }, { status: 400 });

  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;
  const smsOptIn = !!phone;

  // Link to an existing person when we recognize them (don't mint phantoms).
  const person =
    (await prisma.person.findFirst({ where: { email } })) ??
    (phone ? await prisma.person.findFirst({ where: { phone }, orderBy: { isMinor: "asc" } }) : null);

  await prisma.messagingConsent.create({
    data: {
      personId: person?.id ?? null,
      name: [firstName, lastName].filter(Boolean).join(" ") || email,
      email,
      phone,
      emailOptIn: true,
      smsOptIn,
      consentText: consentRecordText(true, smsOptIn),
      consentVersion: CONSENT_VERSION,
      source: "newsletter",
      ipAddress,
      userAgent,
    },
  });

  if (person) {
    const now = new Date();
    await prisma.person.update({
      where: { id: person.id },
      data: { emailConsentAt: now, ...(smsOptIn ? { smsConsentAt: now } : {}) },
    });
  }

  // Subscribe to the Zoho Campaigns list. Best-effort: a signup is still a
  // success for the visitor even if Zoho is momentarily unreachable — the
  // consent is recorded and the admin Zoho sync will pick them up later.
  const z = await pushContactToZoho({ email, firstName, lastName, phone });
  if (!z.ok && !("skipped" in z && z.skipped)) {
    console.error("newsletter: Zoho subscribe failed", z);
  }

  return NextResponse.json({ ok: true });
}
