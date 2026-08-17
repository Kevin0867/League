import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { isZohoConfigured, pushContactToZoho } from "@/lib/integrations/zoho";

// One-time (repeatable) backfill: push every existing registration's
// account-holder contact into Zoho Campaigns. Resumable — it only processes
// contacts not yet marked `zohoSyncedAt`, so running it again continues where it
// left off (and covers anyone added by CSV import since the last run). Capped
// per run so it always finishes within the request budget.
export const dynamic = "force-dynamic";

const PER_RUN = 200;

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/system${qs}`, origin), 303);

  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  if (!actor || !can(actor.role, "manageTeams")) return back("?bferr=auth");
  if (!isZohoConfigured()) return back("?bferr=notconfigured");

  // Every registration's contact: the guardian for a minor, otherwise the
  // player. Dedupe by contact person and skip anyone already synced.
  const regs = await prisma.registration.findMany({
    select: {
      person: {
        select: {
          id: true, firstName: true, lastName: true, email: true, phone: true, isMinor: true, zohoSyncedAt: true,
          guardian: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, zohoSyncedAt: true } },
        },
      },
    },
  });

  const pending = new Map<string, { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null }>();
  for (const r of regs) {
    const p = r.person;
    const contact = p.isMinor && p.guardian ? p.guardian : p;
    if (!contact.email || contact.zohoSyncedAt) continue;
    if (!pending.has(contact.id)) pending.set(contact.id, contact);
  }

  const all = [...pending.values()];
  const batch = all.slice(0, PER_RUN);
  let pushed = 0, failed = 0;
  for (const c of batch) {
    const r = await pushContactToZoho({ email: c.email!, firstName: c.firstName, lastName: c.lastName, phone: c.phone });
    if (r.ok) {
      pushed++;
      await prisma.person.update({ where: { id: c.id }, data: { zohoSyncedAt: new Date() } }).catch(() => {});
    } else {
      failed++;
    }
  }
  const remaining = Math.max(0, all.length - batch.length);

  await audit({ actorId: actor.userId, entityType: "System", entityId: "zoho-backfill", action: "ZOHO_BACKFILL", summary: `Synced ${pushed} contacts to Zoho (${failed} failed, ${remaining} remaining)` });
  return back(`?bfok=1&pushed=${pushed}&failed=${failed}&remaining=${remaining}`);
}
