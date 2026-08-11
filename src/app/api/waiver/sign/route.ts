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

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, isMinor: true, guardianId: true },
  });
  const now = new Date();
  const version = String(formData.get("waiverVersion") ?? "2026-08");

  // One waiver covers the whole household. The signer is the paying adult
  // (guardian) — from any household member's link we resolve up to that adult,
  // then sign for the adult AND every dependent in a single action, so a parent
  // never has to complete a separate waiver per child.
  const rootId = person?.guardianId ?? personId;
  const root = await prisma.person.findUnique({
    where: { id: rootId },
    select: { id: true, isMinor: true, dependents: { select: { id: true } } },
  });
  const family = root
    ? [{ id: root.id, minor: !!root.isMinor }, ...root.dependents.map((d) => ({ id: d.id, minor: true }))]
    : [{ id: personId, minor: !!person?.isMinor }];

  for (const member of family) {
    await prisma.waiver.create({
      data: {
        personId: member.id,
        signedAt: now,
        signatureName,
        mediaConsent: !mediaOptOut,
        // The adult signs on a dependent's behalf → parental consent; and for the
        // adult themselves only if they are (unusually) a minor.
        parentalConsent: member.id !== rootId || member.minor,
        documentVersion: version,
      },
    });
    await prisma.person.update({
      where: { id: member.id },
      data: { waiverSignedAt: now, waiverRenewalRequiredAt: null, mediaOptOut },
    });
  }
  await audit({
    entityType: "Person",
    entityId: rootId,
    action: "WAIVER_SIGNED",
    summary: `Waiver signed by ${signatureName} for ${family.length} household member${family.length === 1 ? "" : "s"}`,
  });

  return NextResponse.redirect(new URL("/waiver/sign?done=1", origin), 303);
}
