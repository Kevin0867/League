import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { PageHeader } from "@/components/RoadmapNote";
import { matchTargetAudience, describeTarget, hasAnyTarget } from "@/lib/domain/classAudience";
import { isZohoConfigured } from "@/lib/integrations/zoho";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invite players to a class" };

export default async function ClassInvitePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  const offering = await prisma.alaCarteOffering.findUnique({
    where: { id },
    include: { facility: true, classSessions: { orderBy: { scheduledAt: "asc" } } },
  });
  if (!offering) notFound();

  const target = {
    targetMinRating: offering.targetMinRating, targetMaxRating: offering.targetMaxRating,
    targetGender: offering.targetGender, targetAgeGroup: offering.targetAgeGroup,
  };
  const targeted = hasAnyTarget(target);
  const matched = targeted ? await matchTargetAudience(target) : [];
  const withEmail = matched.filter((m) => m.email).length;
  const withPhone = matched.filter((m) => m.phone).length;
  const zoho = isZohoConfigured();

  const defaultBody =
    `You're invited to join ${offering.title}${offering.facility ? ` at ${offering.facility.name}` : ""}.\n\n` +
    `This class is a great fit for ${describeTarget(target)}. Spots are limited — reserve yours below.`;

  return (
    <div className="space-y-6">
      <Link href="/console/alacarte" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">← Back to classes &amp; clinics</Link>
      <PageHeader title={`Invite players — ${offering.title}`} subtitle={`Reach the players who match this class's target: ${describeTarget(target)}.`} />

      {sp.ok === "sent" && (
        <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Invitation sent to {sp.sent ?? "0"} player{sp.sent === "1" ? "" : "s"}.
          {sp.failed ? ` ${sp.failed} failed.` : ""}
          {sp.noemail ? ` ${sp.noemail} had no email on file.` : ""}
          {sp.nophone ? ` ${sp.nophone} had no phone for text.` : ""}
          {sp.sim ? ` (${sp.sim} simulated — a messaging provider isn't configured yet.)` : ""}
        </p>
      )}
      {sp.ok === "zoho" && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Synced {sp.synced ?? "0"} contact{sp.synced === "1" ? "" : "s"} to your Zoho list{sp.skipped && sp.skipped !== "0" ? ` (${sp.skipped} skipped — no email or sync error)` : ""}. Build and send the campaign in Zoho Campaigns.</p>}
      {sp.err === "nochannel" && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">Pick at least one channel (portal, email, or text).</p>}
      {sp.err === "noaudience" && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">No players match this class's target right now.</p>}
      {sp.err === "zoho" && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">Zoho isn't connected yet. Connect it under Integrations first.</p>}

      {!targeted ? (
        <div className="card">
          <p className="text-sm text-slate-500">This class has no target set, so there&apos;s no matched audience to invite. Add a DUPR band, gender, or age group on the class first (Edit class), then come back here.</p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-slate-900">Matched players ({matched.length})</h2>
              <p className="text-xs text-slate-400">{withEmail} with email · {withPhone} with phone</p>
            </div>
            {matched.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">No players currently match {describeTarget(target)}. As players&apos; DUPR and profiles fill in, they&apos;ll show up here.</p>
            ) : (
              <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-100">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr><th className="px-3 py-2">Player</th><th className="px-3 py-2">DUPR</th><th className="px-3 py-2">Gender</th><th className="px-3 py-2">Age</th><th className="px-3 py-2">Reachable</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {matched.map((m) => (
                      <tr key={m.id}>
                        <td className="px-3 py-1.5 font-medium text-slate-700">{m.name}</td>
                        <td className="px-3 py-1.5 text-slate-500">{m.duprRating?.toFixed(2) ?? "—"}</td>
                        <td className="px-3 py-1.5 text-slate-500">{m.gender === "MALE" ? "M" : m.gender === "FEMALE" ? "F" : "—"}</td>
                        <td className="px-3 py-1.5 text-slate-500">{m.age ?? "—"}</td>
                        <td className="px-3 py-1.5 text-xs text-slate-400">{[m.email ? "email" : null, m.phone ? "text" : null].filter(Boolean).join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {matched.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Portal / email / text */}
              <form method="POST" action="/api/console/class-invite" className="card space-y-3">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="inviteSend" />
                <input type="hidden" name="offeringId" value={offering.id} />
                <h2 className="font-semibold text-slate-900">Message them directly</h2>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" name="chPortal" defaultChecked /> Portal</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="chEmail" defaultChecked /> Email <span className="text-xs text-slate-400">({withEmail})</span></label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="chText" /> Text <span className="text-xs text-slate-400">({withPhone})</span></label>
                </div>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Subject</span>
                  <input name="subject" className="input w-full" defaultValue={`New class: ${offering.title}`} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Message</span>
                  <textarea name="body" rows={5} className="input w-full" defaultValue={defaultBody} />
                </label>
                <p className="text-xs text-slate-400">The signup link is added automatically if you don&apos;t include it. Text messages send a short version with the link.</p>
                <button className="btn-primary">Send invitation</button>
              </form>

              {/* Zoho campaign */}
              <form method="POST" action="/api/console/class-invite" className="card space-y-3">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="inviteZoho" />
                <input type="hidden" name="offeringId" value={offering.id} />
                <h2 className="font-semibold text-slate-900">Create a Zoho campaign</h2>
                <p className="text-sm text-slate-500">
                  Sync the {withEmail} matched contact{withEmail === 1 ? "" : "s"} (with email) to your Zoho Campaigns list, then compose and send the campaign in Zoho.
                </p>
                {!zoho && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Zoho isn&apos;t connected yet — connect it under Integrations to enable this.</p>}
                <button className="btn-secondary" disabled={!zoho}>Sync {withEmail} to Zoho list</button>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
