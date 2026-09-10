import Link from "next/link";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coaching Agreements" };

const STATUS_LABEL: Record<string, string> = {
  SENT: "Awaiting coach",
  COACH_SIGNED: "Needs countersignature",
  COUNTERSIGNED: "Fully executed",
};

export default async function AgreementsPage() {
  await requireAdmin();
  const rows = await prisma.coachingAgreement.findMany({
    orderBy: [{ status: "asc" }, { coachSignedAt: "desc" }],
    include: { coach: { select: { person: { select: { firstName: true, lastName: true } } } } },
    take: 500,
  });
  const needsAction = rows.filter((r) => r.status === "COACH_SIGNED").length;

  return (
    <div className="space-y-5">
      <PageHeader title="Coaching Agreements" subtitle="Coaches sign digitally; you countersign here. A fully-executed copy stays on the coach's account and here." />

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
