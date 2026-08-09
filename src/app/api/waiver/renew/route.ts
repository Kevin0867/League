import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyWaiverToken } from "@/lib/domain/waiverRenewal";

// Records an adult self-signed waiver from the tokenized renewal link, clears
// the renewal flag, and stamps the person as waiver-current.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();
  const token = formData.get("token")?.toString();
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/waiver/renew?token=${encodeURIComponent(token ?? "")}&${qs}`, origin), 303);

  const personId = await verifyWaiverToken(token);
  if (!personId) return NextResponse.redirect(new URL("/waiver/renew?err=token", origin), 303);

  const signatureName = String(formData.get("signatureName") ?? "").trim();
  if (formData.get("agree") !== "on") return back("err=agree");
  if (!signatureName) return back("err=name");
  const mediaOptOut = formData.get("mediaOptOut") === "on";

  await prisma.waiver.create({
    data: {
      personId,
      signedAt: new Date(),
      signatureName,
      mediaConsent: !mediaOptOut,
      parentalConsent: false,
      documentVersion: String(formData.get("waiverVersion") ?? "2026-08"),
    },
  });
  await prisma.person.update({
    where: { id: personId },
    data: { waiverSignedAt: new Date(), waiverRenewalRequiredAt: null, mediaOptOut },
  });

  return NextResponse.redirect(new URL("/waiver/renew?done=1", origin), 303);
}
