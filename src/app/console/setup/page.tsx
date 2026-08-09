import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { redirect } from "next/navigation";
import {
  CreateSeasonForm,
  ActivateButton,
  StandardDivisionsButton,
  DeleteDivisionButton,
  AddDivisionForm,
} from "./SetupForms";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const session = await requireStaff();
  if (!["COO", "DIRECTOR"].includes(session.role)) redirect("/console");

  const seasons = await prisma.season.findMany({
    orderBy: [{ active: "desc" }, { startDate: "desc" }],
    include: {
      divisions: { orderBy: { name: "asc" }, include: { _count: { select: { registrations: true } } } },
      _count: { select: { registrations: true } },
    },
  });

  const facilityCount = await prisma.facility.count();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Season setup</h1>
        <p className="text-slate-500">
          Create your season and its divisions. Registration attaches each signup to
          the <span className="font-medium">active</span> PURE Academy season — so this
          must exist before you open enrollment.
        </p>
      </div>

      {/* Readiness checklist */}
      <div className="card">
        <h2 className="font-semibold text-brand-900">Launch readiness</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <Check ok={seasons.some((s) => s.active && s.program === "PURE_ACADEMY")}>
            An active PURE Academy season exists
          </Check>
          <Check ok={seasons.some((s) => s.active && s.divisions.length > 0)}>
            The active season has divisions
          </Check>
          <Check ok={facilityCount > 0}>
            At least one facility is set up (<Link href="/console/facilities" className="text-accent-700 underline">Facilities</Link>)
          </Check>
        </ul>
      </div>

      <CreateSeasonForm />

      {seasons.length === 0 && (
        <p className="text-slate-500">No seasons yet — create one to get started.</p>
      )}

      {seasons.map((s) => (
        <div key={s.id} className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-brand-900">
                {s.name}{" "}
                {s.active ? (
                  <span className="badge bg-accent-100 text-accent-800">Active</span>
                ) : (
                  <span className="badge bg-slate-100 text-slate-500">Inactive</span>
                )}
              </h2>
              <p className="text-xs text-slate-500">
                {s.program} · {new Date(s.startDate).toLocaleDateString()} –{" "}
                {new Date(s.endDate).toLocaleDateString()} · {s._count.registrations} registrations
              </p>
            </div>
            {!s.active && <ActivateButton seasonId={s.id} />}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">
                Divisions ({s.divisions.length})
              </h3>
              {s.divisions.length === 0 && <StandardDivisionsButton seasonId={s.id} />}
            </div>
            {s.divisions.length > 0 && (
              <ul className="mb-3 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                {s.divisions.map((d) => (
                  <li key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>
                      {d.name}
                      {d.minRating != null && (
                        <span className="ml-2 text-xs text-slate-400">
                          {d.minRating}
                          {d.maxRating != null ? `–${d.maxRating}` : "+"}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-slate-400">{d._count.registrations} reg.</span>
                      {d._count.registrations === 0 && <DeleteDivisionButton divisionId={d.id} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <AddDivisionForm seasonId={s.id} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className={ok ? "text-accent-600" : "text-slate-300"}>{ok ? "✓" : "○"}</span>
      <span className={ok ? "text-slate-700" : "text-slate-500"}>{children}</span>
    </li>
  );
}
