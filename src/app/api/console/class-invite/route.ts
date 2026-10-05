import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage, type Channel } from "@/lib/messaging";
import { matchTargetAudience } from "@/lib/domain/classAudience";
import { pushContactToZoho, isZohoConfigured } from "@/lib/integrations/zoho";

// Marketing an admin-targeted class to the players who match it. The audience is
// ALWAYS recomputed here from the class's own targeting (never trusted from the
// form), so a tampered request can't reach anyone outside the target. The admin
// picks the channels: portal (IN_APP), email, text (SMS), and/or a Zoho sync.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  const g = (k: string) => String(fd.get(k) ?? "").trim();
  const offeringId = g("offeringId");
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/alacarte/${offeringId}/invite${qs}`, origin), 303);

  if (!actor || !can(actor.role, "manageAlaCarte")) return back("?err=auth");

  const offering = await prisma.alaCarteOffering.findUnique({
    where: { id: offeringId },
    include: { facility: true, classSessions: { orderBy: { scheduledAt: "asc" } } },
  });
  if (!offering) return back("?err=notfound");

  const matched = await matchTargetAudience(offering);
  if (matched.length === 0) return back("?err=noaudience");
  const personIds = matched.map((m) => m.id);

  const op = g("op");
  const link = `${origin}/clinics/${offering.id}`;

  if (op === "inviteSend") {
    const channels: Channel[] = [];
    if (fd.get("chPortal")) channels.push("IN_APP");
    if (fd.get("chEmail")) channels.push("EMAIL");
    if (fd.get("chText")) channels.push("SMS");
    if (channels.length === 0) return back("?err=nochannel");

    const subject = g("subject") || `New class: ${offering.title}`;
    const bodyText = g("body") || `You're invited to ${offering.title}. Reserve your spot: ${link}`;
    // Always make sure the signup link is in the body.
    const body = bodyText.includes(link) ? bodyText : `${bodyText}\n\nReserve your spot: ${link}`;
    const smsBody = `${subject} — ${link}`;

    const res = await dispatchMessage({
      senderId: actor.userId,
      audienceType: "PERSON_LIST",
      audienceRef: personIds.join(","),
      channels,
      subject,
      body,
      smsBody,
      triggerType: "CLASS_INVITE",
    });

    await audit({
      actorId: actor.userId, entityType: "AlaCarteOffering", entityId: offering.id, action: "CLASS_INVITE",
      summary: `Invited ${matched.length} matched player(s) to ${offering.title} via ${channels.join("/")} — ${res.recipients} sent, ${res.failures} failed`,
    });

    const flags = [
      `sent=${res.recipients}`,
      res.failures ? `failed=${res.failures}` : "",
      res.noEmail ? `noemail=${res.noEmail}` : "",
      res.noPhone ? `nophone=${res.noPhone}` : "",
      res.simulated ? `sim=${res.simulated}` : "",
    ].filter(Boolean).join("&");
    return back(`?ok=sent&${flags}`);
  }

  if (op === "inviteZoho") {
    if (!isZohoConfigured()) return back("?err=zoho");
    let synced = 0, skipped = 0;
    for (const m of matched) {
      if (!m.email) { skipped++; continue; }
      const [firstName, ...rest] = m.name.split(" ");
      const r = await pushContactToZoho({ email: m.email, firstName, lastName: rest.join(" "), phone: m.phone });
      if (r.ok) synced++; else skipped++;
    }
    await audit({
      actorId: actor.userId, entityType: "AlaCarteOffering", entityId: offering.id, action: "CLASS_ZOHO_SYNC",
      summary: `Synced ${synced} matched contact(s) for ${offering.title} to Zoho (${skipped} skipped)`,
    });
    return back(`?ok=zoho&synced=${synced}&skipped=${skipped}`);
  }

  return back("?err=op");
}
