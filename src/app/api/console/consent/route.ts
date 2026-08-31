import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { CONSENT_VERSION } from "@/lib/consent";

// Admin bulk opt-in: record everyone with a contact method as consented to
// email / SMS. Used when consent was gathered off-platform (e.g. at
// registration) but the flags weren't set. Every person also gets a
// MessagingConsent row so the basis is auditable for TCPA / A2P 10DLC.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/consent${qs}`, origin), 303);
  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor || !can(actor.role, "manageUsers")) return back("?err=auth");
  if (String(fd.get("op") ?? "") !== "bulkOptIn") return back("?err=op");

  const now = new Date();
  const people = await prisma.person.findMany({
    where: {
      OR: [
        { AND: [{ email: { not: null } }, { emailConsentAt: null }] },
        { AND: [{ phone: { not: null } }, { smsConsentAt: null }] },
      ],
    },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, emailConsentAt: true, smsConsentAt: true },
  });

  let emailN = 0, smsN = 0;
  for (const p of people) {
    const setEmail = !!p.email && !p.emailConsentAt;
    const setSms = !!p.phone && !p.smsConsentAt;
    if (!setEmail && !setSms) continue;
    await prisma.person.update({
      where: { id: p.id },
      data: { ...(setEmail ? { emailConsentAt: now } : {}), ...(setSms ? { smsConsentAt: now } : {}) },
    });
    await prisma.messagingConsent.create({
      data: {
        personId: p.id,
        name: `${p.firstName} ${p.lastName}`.trim(),
        email: p.email,
        phone: p.phone,
        emailOptIn: setEmail,
        smsOptIn: setSms,
        consentText: "Bulk opt-in recorded by an administrator — consent gathered during registration/onboarding.",
        consentVersion: CONSENT_VERSION,
        source: "admin-bulk",
      },
    });
    if (setEmail) emailN++;
    if (setSms) smsN++;
  }

  await audit({ actorId: actor.userId, entityType: "MessagingConsent", entityId: "bulk", action: "BULK_OPT_IN", summary: `Bulk opt-in: ${emailN} email, ${smsN} SMS newly recorded` });
  return back(`?ok=bulk&e=${emailN}&s=${smsN}`);
}
