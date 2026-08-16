import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { mintConsoleTicket } from "@/lib/auth";
import { formatTime12 } from "@/lib/time";
import { TableFilter } from "@/components/TableFilter";
import { FacilityForm, DeleteFacilityButton } from "./FacilityForm";
import { requireAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const FEE_LABEL: Record<string, string> = {
  NONE: "No fee / in-kind",
  PER_COURT: "Per court",
  PER_HOUR: "Per hour",
  PER_SESSION: "Per session",
  PERCENTAGE: "Percentage of on-site revenue",
};

const DAY_LABEL: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };

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
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const allFacilities = await prisma.facility.findMany({
    include: {
      _count: { select: { teams: true, sessions: true } },
      courtBlocks: { orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
    },
    orderBy: [{ agreementStatus: "asc" }, { name: "asc" }],
  });
  const facilities = allFacilities.filter((f) => !f.archived);
  const archivedFacilities = allFacilities.filter((f) => f.archived);

  const executed = facilities.filter((f) => f.agreementStatus === "EXECUTED").length;

  return (
    <div className="space-y-6">
      {(sp.ok === "edited" || sp.ok === "deleted" || sp.ok === "archived" || sp.ok === "unarchived" || sp.added) && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {sp.ok === "edited" ? "Facility updated." : sp.ok === "deleted" ? "Facility removed." : sp.ok === "archived" ? "Facility archived — hidden from scheduling." : sp.ok === "unarchived" ? "Facility restored." : "Facility added."}
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
        <>
        <div className="max-w-md">
          <TableFilter targetId="facilities-grid" placeholder="Search facilities by name or market…" />
        </div>
        <div id="facilities-grid" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {facilities.map((f) => {
            const rate =
              f.feeBasis === "PERCENTAGE"
                ? `${((f.percentageRate ?? 0) * 100).toFixed(0)}% of on-site revenue`
                : f.feeBasis === "NONE"
                ? "No fee (in-kind)"
                : `${formatCents(f.weekdayRateCents)} weekday / ${formatCents(f.weekendRateCents)} weekend`;
            const nextAction = NEXT_ACTION[f.agreementStatus];
            return (
              <div key={f.id} data-filter-row data-filter-text={`${f.name} ${f.market ?? ""}`} className="card flex flex-col gap-4">
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
                    label="Private Lessons"
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

                <div className="border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Availability</div>
                    {f.lights === "LIGHTS" && <span className="badge bg-amber-100 text-amber-800">Lights</span>}
                    {f.lights === "NO_LIGHTS" && <span className="badge bg-slate-200 text-slate-600">No lights</span>}
                  </div>
                  {(() => {
                    const open = f.courtBlocks.filter((b) => (b.kind ?? "AVAILABLE") === "AVAILABLE");
                    const blocked = f.courtBlocks.filter((b) => b.kind === "BLOCKED");
                    return (
                      <>
                        {open.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {open.map((b) => (
                              <span key={b.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                                {DAY_LABEL[b.dayOfWeek] ?? b.dayOfWeek} {formatTime12(b.startTime)}–{formatTime12(b.endTime)}
                                {b.courtCount > 1 ? ` · ${b.courtCount} courts` : ""}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1.5 text-xs text-amber-600">
                            No open times set — teams can be scheduled here any day/time. Add windows via Edit to limit team
                            scheduling to when this court is actually open.
                          </p>
                        )}
                        {blocked.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span className="text-xs text-rose-500">Blocked:</span>
                            {blocked.map((b) => (
                              <span key={b.id} className="rounded bg-rose-50 px-2 py-0.5 text-xs text-rose-700 ring-1 ring-rose-100">
                                {DAY_LABEL[b.dayOfWeek] ?? b.dayOfWeek} {formatTime12(b.startTime)}–{formatTime12(b.endTime)}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                  {f.notes && (
                    <p className="mt-2 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <span className="font-medium text-slate-500">Notes: </span>{f.notes}
                    </p>
                  )}
                </div>

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
                      lights: f.lights, notes: f.notes,
                      alaCarteAllowed: f.alaCarteAllowed, acpLeagueOption: f.acpLeagueOption,
                      courtBlocks: f.courtBlocks.map((b) => ({ dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime, courtCount: b.courtCount, kind: b.kind })),
                    }}
                  />
                  <div className="flex items-center gap-3">
                    <form method="POST" action="/api/console/facilities">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="archive" />
                      <input type="hidden" name="facilityId" value={f.id} />
                      <button className="text-xs text-slate-500 hover:underline">Archive</button>
                    </form>
                    <DeleteFacilityButton
                      facilityId={f.id}
                      ticket={ticket}
                      inUse={f._count.teams > 0 || f._count.sessions > 0}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          <div data-filter-empty hidden className="card py-8 text-center text-sm text-slate-400 md:col-span-2">No facilities match your search.</div>
        </div>
        </>
      )}

      {archivedFacilities.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            Archived facilities ({archivedFacilities.length})
          </summary>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {archivedFacilities.map((f) => (
              <li key={f.id} className="flex items-center justify-between py-2">
                <span className="text-slate-500">
                  {f.name}
                  <span className="ml-2 text-xs text-slate-400">{f.market ?? "no market"}</span>
                </span>
                <form method="POST" action="/api/console/facilities">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="unarchive" />
                  <input type="hidden" name="facilityId" value={f.id} />
                  <button className="text-xs font-medium text-brand-600 hover:underline">Restore</button>
                </form>
              </li>
            ))}
          </ul>
        </details>
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
