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

  // Inline fix from the sync-failures list: correct a person's email, then
  // immediately re-push that one contact to Zoho so the fix is confirmed on the
  // spot (no separate re-sync needed).
  if (String(formData.get("op") ?? "") === "fixEmail") {
    const personId = String(formData.get("personId") ?? "");
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    // Keep the other still-failing rows on screen after this one is handled.
    const carry = (extra: string) => {
      let remaining: { id: string; email: string; reason: string }[] = [];
      try { remaining = JSON.parse(String(formData.get("failrows") ?? "[]")).filter((r: { id: string }) => r.id !== personId); } catch { /* none */ }
      return back(`${extra}${remaining.length ? `&failrows=${encodeURIComponent(JSON.stringify(remaining))}` : ""}`);
    };
    if (!personId) return carry("?fixerr=missing");
    if (!/.+@.+\..+/.test(email)) return carry(`?fixerr=badformat&fixemail=${encodeURIComponent(email)}`);
    const person = await prisma.person.findUnique({ where: { id: personId }, select: { firstName: true, lastName: true, phone: true } });
    if (!person) return carry("?fixerr=notfound");
    // Save the corrected email and clear the synced flag so a full re-run also
    // retries them if this immediate push is skipped/unavailable.
    await prisma.person.update({ where: { id: personId }, data: { email, zohoSyncedAt: null } });
    const r = await pushContactToZoho({ email, firstName: person.firstName, lastName: person.lastName, phone: person.phone });
    if (r.ok) {
      await prisma.person.update({ where: { id: personId }, data: { zohoSyncedAt: new Date() } }).catch(() => {});
      await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: "ZOHO_FIX_EMAIL", summary: `Corrected email to ${email} and synced to Zoho` });
      return carry(`?fixok=1&fixemail=${encodeURIComponent(email)}`);
    }
    const why = "error" in r && r.error ? r.error : "skipped" in r && r.skipped ? r.reason : "still rejected";
    await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: "ZOHO_FIX_EMAIL", summary: `Corrected email to ${email}; Zoho still rejected (${why})` });
    return carry(`?fixfail=1&fixemail=${encodeURIComponent(email)}&fixwhy=${encodeURIComponent(String(why).slice(0, 120))}`);
  }

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
  const reasons: string[] = [];
  const failRows: { id: string; email: string; reason: string }[] = [];
  for (const c of batch) {
    const r = await pushContactToZoho({ email: c.email!, firstName: c.firstName, lastName: c.lastName, phone: c.phone });
    if (r.ok) {
      pushed++;
      await prisma.person.update({ where: { id: c.id }, data: { zohoSyncedAt: new Date() } }).catch(() => {});
    } else {
      failed++;
      const why = "error" in r && r.error ? r.error : "skipped" in r && r.skipped ? r.reason : "unknown";
      if (reasons.length < 10) {
        reasons.push(`${c.email} — ${why}`);
        // Carry the personId so the System page can offer an inline "fix email".
        failRows.push({ id: c.id, email: c.email!, reason: String(why).slice(0, 120) });
      }
    }
  }
  const remaining = Math.max(0, all.length - batch.length);

  await audit({ actorId: actor.userId, entityType: "System", entityId: "zoho-backfill", action: "ZOHO_BACKFILL", summary: `Synced ${pushed} contacts to Zoho (${failed} failed, ${remaining} remaining)${reasons.length ? ` — ${reasons.join("; ")}` : ""}` });
  const qs = new URLSearchParams({ bfok: "1", pushed: String(pushed), failed: String(failed), remaining: String(remaining) });
  if (failRows.length) qs.set("failrows", JSON.stringify(failRows));
  return back(`?${qs.toString()}`);
}
