import Link from "next/link";
import { requireAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/time";
import { unsignedCoaches } from "@/lib/domain/coachingAgreement";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coaching Agreements" };

const STATUS_LABEL: Record<string, string> = {
  SENT: "Awaiting coach",
  COACH_SIGNED: "Needs countersignature",
  COUNTERSIGNED: "Fully executed",
};

export default async function AgreementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const rows = await prisma.coachingAgreement.findMany({
    orderBy: [{ status: "asc" }, { coachSignedAt: "desc" }],
    include: { coach: { select: { person: { select: { firstName: true, lastName: true } } } } },
    take: 500,
  });
  const needsAction = rows.filter((r) => r.status === "COACH_SIGNED").length;
  const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, orderBy: { startDate: "desc" }, select: { id: true } })
    ?? await prisma.season.findFirst({ where: { active: true }, orderBy: { startDate: "desc" }, select: { id: true } });
  const unsigned = await unsignedCoaches(season?.id ?? null);
  const unsignedReachable = unsigned.filter((c) => c.email || c.phone).length;

  return (
    <div className="space-y-5">
      <PageHeader title="Coaching Agreements" subtitle="Coaches sign digitally; you countersign here. A fully-executed copy stays on the coach's account and here." />

      {sp.ok === "reminded" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          Agreement reminder sent to {sp.n ?? 0} coach{sp.n === "1" ? "" : "es"} by text and email.{sp.nc ? ` ${sp.nc} had no contact info on file.` : ""}
        </div>
      )}

      {unsigned.length > 0 && (
        <div className="card border-l-4 border-amber-400">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">{unsigned.length} coach{unsigned.length === 1 ? " hasn't" : "es haven't"} signed yet</h2>
              <p className="text-sm text-slate-500">Send them their agreement to sign — by text and email.</p>
            </div>
            {unsignedReachable > 0 && (
              <form method="POST" action="/api/console/coaching-agreement">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="remindAgreementAll" />
                <input type="hidden" name="returnTo" value="/console/agreements" />
                <button className="btn-primary text-sm">Text all unsigned ({unsignedReachable})</button>
              </form>
            )}
          </div>
          <ul className="mt-3 divide-y divide-slate-100">
            {unsigned.map((c) => (
              <li key={c.coachId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-slate-800">{c.name}</span>
                  <span className="ml-2 text-xs text-slate-400">{[c.phone, c.email].filter(Boolean).join(" · ") || "no contact on file"}</span>
                </div>
                {(c.email || c.phone) ? (
                  <form method="POST" action="/api/console/coaching-agreement">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value="remindAgreement" />
                    <input type="hidden" name="personId" value={c.personId} />
                    <input type="hidden" name="returnTo" value="/console/agreements" />
                    <button className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100">Text agreement</button>
                  </form>
                ) : (
                  <Link href={`/console/coaches/${c.personId}`} className="text-xs text-amber-700 hover:underline">Add contact →</Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {needsAction > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{needsAction}</strong> agreement{needsAction === 1 ? "" : "s"} signed by a coach and waiting for your countersignature.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card text-sm text-slate-400">No coaching agreements yet. They appear here once a coach signs theirs.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2">Coach</th>
                <th>Status</th>
                <th>Coach signed</th>
                <th>Countersigned</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className={r.status === "COACH_SIGNED" ? "bg-amber-50/50" : ""}>
                  <td className="px-4 py-2 font-medium text-slate-800">{r.coach.person.firstName} {r.coach.person.lastName}</td>
                  <td><span className="text-xs text-slate-600">{STATUS_LABEL[r.status] ?? r.status}</span></td>
                  <td className="text-slate-500">{r.coachSignedAt ? formatDate(r.coachSignedAt) : "—"}</td>
                  <td className="text-slate-500">{r.adminSignedAt ? formatDate(r.adminSignedAt) : "—"}</td>
                  <td className="px-4 text-right">
                    <Link href={`/console/agreements/${r.id}`} className="btn-link text-xs">
                      {r.status === "COACH_SIGNED" ? "Review & countersign →" : "View →"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
