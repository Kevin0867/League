import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const FEE_LABEL: Record<string, string> = {
  NONE: "No fee / in-kind",
  PER_COURT: "Per court",
  PER_HOUR: "Per hour",
  PER_SESSION: "Per session",
  PERCENTAGE: "Percentage of on-site revenue",
};

const NEXT_ACTION: Record<string, string> = {
  IDENTIFIED: "Make first contact",
  VERBAL: "Send agreement",
  AGREEMENT_SENT: "Follow up for signature",
  EXECUTED: "—",
};

export default async function FacilitiesPage() {
  const facilities = await prisma.facility.findMany({
    include: { _count: { select: { teams: true, sessions: true } } },
    orderBy: [{ agreementStatus: "asc" }, { name: "asc" }],
  });

  const executed = facilities.filter((f) => f.agreementStatus === "EXECUTED").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Facility agreement tracker</h1>
        <p className="text-slate-500">
          {executed}/{facilities.length} executed. Court blocks can&apos;t be published
          against a non-executed agreement without an explicit override.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-2">Facility</th>
              <th>Market</th>
              <th>Courts</th>
              <th>Fee basis</th>
              <th>Rate (wd / we)</th>
              <th>À la carte</th>
              <th>Agreement</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {facilities.map((f) => (
              <tr key={f.id}>
                <td className="py-2">
                  <div className="font-medium text-slate-800">{f.name}</div>
                  {f.isPrivate && (
                    <div className="text-xs text-amber-600">private · shown publicly as “{f.generalArea ?? f.market}”</div>
                  )}
                  <div className="text-xs text-slate-400">{f.primaryContact ?? "no contact"}</div>
                </td>
                <td className="text-slate-600">{f.market ?? "—"}</td>
                <td className="text-slate-600">{f.courtCount}</td>
                <td className="text-slate-600">{FEE_LABEL[f.feeBasis] ?? f.feeBasis}</td>
                <td className="text-slate-600">
                  {f.feeBasis === "PERCENTAGE"
                    ? `${((f.percentageRate ?? 0) * 100).toFixed(0)}%`
                    : f.feeBasis === "NONE"
                    ? "—"
                    : `${formatCents(f.weekdayRateCents)} / ${formatCents(f.weekendRateCents)}`}
                </td>
                <td>
                  {f.alaCarteAllowed
                    ? <span className="badge bg-emerald-100 text-emerald-800">allowed</span>
                    : <span className="badge bg-slate-100 text-slate-500">no</span>}
                </td>
                <td><StatusBadge status={f.agreementStatus} /></td>
                <td className="text-slate-500">{NEXT_ACTION[f.agreementStatus]}</td>
              </tr>
            ))}
            {facilities.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-slate-400">No facilities yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
