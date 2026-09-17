import Link from "next/link";
import { requireAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { TextResetLinkButton } from "@/components/TextResetLinkButton";
import { playersWithoutPortalAccess, playerAccountPersonIds } from "@/lib/domain/portalAccess";
import { RESET_STATUS } from "@/lib/domain/resetStatus";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portal access" };

export default async function PortalAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, orderBy: { startDate: "desc" }, select: { id: true, name: true } })
    ?? await prisma.season.findFirst({ where: { active: true }, orderBy: { startDate: "desc" }, select: { id: true, name: true } });
  const players = season ? await playersWithoutPortalAccess(season.id) : [];
  const sendable = players.filter((p) => p.hasEmail);
  const needEmail = players.filter((p) => !p.hasEmail);
  const allHouseholds = season ? (await playerAccountPersonIds(season.id)).length : 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Portal access" subtitle="Registered players whose household has no active login yet — send them a set-password link (text + email) so they can get in. Minors are covered by a parent/guardian login." />

      {sp.reset === "bulk" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Sent portal access to {sp.n ?? 0} player{sp.n === "1" ? "" : "s"} by text and email.</div>
      )}
      {sp.reset === "bulkall" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Sent a portal set/reset link to {sp.n ?? 0} household{sp.n === "1" ? "" : "s"} by text and email.</div>
      )}

      {/* Send to everyone — not just those without access. */}
      {allHouseholds > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Send a portal link to every player</div>
            <p className="text-xs text-slate-500">Texts + emails a set/reset-password link to all {allHouseholds} household{allHouseholds === 1 ? "" : "s"} in {season?.name ?? "the season"} (one per family). It doesn&apos;t change anyone&apos;s current password — it just gives everyone a fresh way in.</p>
          </div>
          <ConfirmSubmit
            action="/api/console/reset-link"
            fields={{ ticket, op: "sendAllPlayers", returnTo: "/console/portal-access" }}
            confirm={`Send a portal set/reset link (text + email) to ALL ${allHouseholds} households now?`}
            label="Send to every player"
            className="btn-secondary text-sm"
          />
        </div>
      )}
      {(() => { const r = RESET_STATUS(sp.reset === "bulk" ? undefined : sp.reset, sp.resetVia, sp.resetNew); return r ? <p className={`rounded-lg px-3 py-2 text-sm ${r.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{r.text}</p> : null; })()}

      {players.length === 0 ? (
        <div className="card text-sm text-slate-500">🎉 Everyone registered for {season?.name ?? "the active season"} has portal access. No one to invite.</div>
      ) : (
        <>
          <div className="card flex flex-wrap items-center justify-between gap-3 border-l-4 border-amber-400">
            <div>
              <div className="text-sm font-semibold text-slate-900">{players.length} player{players.length === 1 ? "" : "s"} can&apos;t log in yet</div>
              <p className="text-xs text-slate-500">
                {sendable.length} can be sent access now{needEmail.length > 0 ? ` · ${needEmail.length} need an email added first` : ""}.
              </p>
            </div>
            {sendable.length > 0 && (
              <form method="POST" action="/api/console/reset-link">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="sendAllNoAccess" />
                <input type="hidden" name="returnTo" value="/console/portal-access" />
                <button className="btn-primary text-sm">Send access to all ({sendable.length})</button>
              </form>
            )}
          </div>

          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2">Player</th>
                  <th>Contact on file</th>
                  <th>Why</th>
                  <th className="text-right px-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {players.map((p) => (
                  <tr key={p.personId}>
                    <td className="px-4 py-2 font-medium text-slate-800">
                      <Link href={`/console/registrations?q=${encodeURIComponent(p.name)}`} className="hover:text-brand-700 hover:underline">{p.name}</Link>
                      {p.isMinor && <span className="ml-2 badge bg-amber-100 text-amber-800">minor</span>}
                    </td>
                    <td className="text-slate-500">{p.contact}</td>
                    <td className="text-slate-500">{p.reason === "disabled" ? "login disabled" : "no login yet"}</td>
                    <td className="px-4 text-right">
                      {p.hasEmail ? (
                        <TextResetLinkButton personId={p.personId} ticket={ticket} returnTo="/console/portal-access" label="Send access" />
                      ) : (
                        <Link href={`/console/registrations?q=${encodeURIComponent(p.name)}`} className="btn-chip-brand">Add an email →</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
