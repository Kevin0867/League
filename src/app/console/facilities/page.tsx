import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { mintConsoleTicket } from "@/lib/auth";
import { FacilityForm, DeleteFacilityButton } from "./FacilityForm";

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

export default async function FacilitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const facilities = await prisma.facility.findMany({
    include: { _count: { select: { teams: true, sessions: true } } },
    orderBy: [{ agreementStatus: "asc" }, { name: "asc" }],
  });

  const executed = facilities.filter((f) => f.agreementStatus === "EXECUTED").length;

  return (
    <div className="space-y-6">
      {(sp.ok === "edited" || sp.ok === "deleted" || sp.added) && (
        <div className="rounded-lg bg-accent-50 px-4 py-2 text-sm text-accent-800">
          {sp.ok === "edited" ? "Facility updated." : sp.ok === "deleted" ? "Facility removed." : "Facility added."}
        </div>
      )}
      {sp.err && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">
          {sp.err === "auth"
            ? "Not authorized to manage facilities."
            : sp.err === "inuse"
            ? "That facility is used by teams or sessions and can't be removed."
            : sp.err === "notfound"
            ? "Facility not found."
            : "Please check the required fields."}
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Facility agreement tracker</h1>
          <p className="text-slate-500">
            {executed}/{facilities.length} executed. Court blocks can&apos;t be published
            against a non-executed agreement without an explicit override.
          </p>
        </div>
        <FacilityForm ticket={ticket} />
      </div>

      {facilities.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">No facilities yet.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {facilities.map((f) => {
            const rate =
              f.feeBasis === "PERCENTAGE"
                ? `${((f.percentageRate ?? 0) * 100).toFixed(0)}% of on-site revenue`
                : f.feeBasis === "NONE"
                ? "No fee (in-kind)"
                : `${formatCents(f.weekdayRateCents)} weekday / ${formatCents(f.weekendRateCents)} weekend`;
            const nextAction = NEXT_ACTION[f.agreementStatus];
            return (
              <div key={f.id} className="card flex flex-col gap-4">
                {/* Header: name + agreement status */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900">{f.name}</div>
                    <div className="mt-0.5 text-sm text-slate-500">
                      {f.market ?? "No market"} · {f.courtCount} court{f.courtCount === 1 ? "" : "s"}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">{f.primaryContact ?? "No contact on file"}</div>
                    {f.isPrivate && (
                      <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                        Private · shown publicly as “{f.generalArea ?? f.market}”
                      </div>
                    )}
                  </div>
                  <StatusBadge status={f.agreementStatus} />
                </div>

                {/* Details */}
                <dl className="grid grid-cols-1 gap-y-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 sm:gap-x-4">
                  <Detail label="Fee basis" value={FEE_LABEL[f.feeBasis] ?? f.feeBasis} />
                  <Detail label="Rate" value={rate} />
                  <Detail
                    label="À la carte"
                    value={
                      f.alaCarteAllowed
                        ? <span className="badge bg-emerald-100 text-emerald-800">Allowed</span>
                        : <span className="badge bg-slate-100 text-slate-500">Not allowed</span>
                    }
                  />
                  <Detail
                    label="Next action"
                    value={nextAction === "—"
                      ? <span className="text-slate-400">Nothing pending</span>
                      : <span className="font-medium text-slate-700">{nextAction}</span>}
                  />
                </dl>

                <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                  <FacilityForm
                    ticket={ticket}
                    facility={{
                      id: f.id, name: f.name, market: f.market, courtCount: f.courtCount,
                      agreementStatus: f.agreementStatus, feeBasis: f.feeBasis,
                      weekdayRateCents: f.weekdayRateCents, weekendRateCents: f.weekendRateCents,
                      percentageRate: f.percentageRate, primaryContact: f.primaryContact,
                      contactEmail: f.contactEmail, contactPhone: f.contactPhone, isPrivate: f.isPrivate,
                      generalArea: f.generalArea, exactAddress: f.exactAddress,
                      alaCarteAllowed: f.alaCarteAllowed, acpLeagueOption: f.acpLeagueOption,
                    }}
                  />
                  <DeleteFacilityButton
                    facilityId={f.id}
                    ticket={ticket}
                    inUse={f._count.teams > 0 || f._count.sessions > 0}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-700">{value}</dd>
    </div>
  );
}
