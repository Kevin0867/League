import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyWaiverToken } from "@/lib/domain/waiverRenewal";
import { audit } from "@/lib/audit";

// Records a waiver signed from an admin-sent link and stamps the person as
// waiver-current with the signed date/time. For a minor, the signer is the
// parent/guardian (parentalConsent = true).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();
  const token = formData.get("token")?.toString();
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/waiver/sign?token=${encodeURIComponent(token ?? "")}&${qs}`, origin), 303);

  const personId = await verifyWaiverToken(token);
  if (!personId) return NextResponse.redirect(new URL("/waiver/sign?err=token", origin), 303);

  const signatureName = String(formData.get("signatureName") ?? "").trim();
  if (formData.get("agree") !== "on") return back("err=agree");
  if (!signatureName) return back("err=name");
  const mediaOptOut = formData.get("mediaOptOut") === "on";

  const person = await prisma.person.findUnique({ where: { id: personId }, select: { isMinor: true } });
  const now = new Date();

  await prisma.waiver.create({
    data: {
      personId,
      signedAt: now,
      signatureName,
      mediaConsent: !mediaOptOut,
      parentalConsent: !!person?.isMinor,
      documentVersion: String(formData.get("waiverVersion") ?? "2026-08"),
    },
  });
  await prisma.person.update({
    where: { id: personId },
    data: { waiverSignedAt: now, waiverRenewalRequiredAt: null, mediaOptOut },
  });
  await audit({ entityType: "Person", entityId: personId, action: "WAIVER_SIGNED", summary: `Waiver signed by ${signatureName}` });

  return NextResponse.redirect(new URL("/waiver/sign?done=1", origin), 303);
}
