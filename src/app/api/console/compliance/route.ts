import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { signWaiverToken } from "@/lib/domain/waiverRenewal";
import { waiverRequestEmail } from "@/lib/email/waiverRequestEmail";
import { appUrl } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const op = String(fd.get("op") ?? "");
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/compliance${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor || !isAdmin(actor.roles)) return back("?err=auth");

  if (op === "sendAllWaivers") {
    // Everyone who is registered but has no signed waiver on file.
    const people = await prisma.person.findMany({
      where: { waiverSignedAt: null, registrations: { some: {} } },
      select: { id: true, firstName: true, isMinor: true },
    });

    let sent = 0;
    for (const p of people) {
      const token = await signWaiverToken(p.id);
      const link = `${appUrl()}/waiver/sign?token=${encodeURIComponent(token)}`;
      const email = waiverRequestEmail({ name: p.firstName, link, isMinor: p.isMinor });
      await dispatchMessage({
        senderId: actor.userId,
        audienceType: "SINGLE_PERSON",
        audienceRef: p.id,
        channels: ["IN_APP", "EMAIL", "SMS"],
        triggerType: "WAIVER_REQUEST",
        subject: email.subject,
        body: email.text,
        html: email.html,
        smsBody: `PURE Academy: please complete your participation waiver before your first session — ${link}`,
      }).catch(() => {});
      sent++;
    }

    await audit({ actorId: actor.userId, entityType: "Person", entityId: "*", action: "WAIVER_REQUESTED_BULK", summary: `Sent waiver request to ${sent} outstanding player${sent === 1 ? "" : "s"}` });
    return back(`?ok=waivers&n=${sent}`);
  }

  return back("?err=op");
}
