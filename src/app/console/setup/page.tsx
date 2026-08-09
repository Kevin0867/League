import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  CreateSeasonForm,
  ActivateButton,
  StandardDivisionsButton,
  DeleteDivisionButton,
  AddDivisionForm,
} from "./SetupForms";

export const dynamic = "force-dynamic";

const OK_MESSAGE: Record<string, string> = {
  createSeason: "Season created.",
  activateSeason: "Season activated.",
  addDivision: "Division added.",
  deleteDivision: "Division removed.",
  addStandardDivisions: "Standard divisions added.",
};

const ERR_MESSAGE: Record<string, string> = {
  auth: "You are not authorized to manage season setup.",
  fields: "Please fill in the required fields.",
  notfound: "Season not found.",
  hasregistrations: "Can't delete a division that has registrations.",
  season: "A season is required.",
  op: "Unknown action.",
};

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // Auth enforced by the console layout; only refine role (never bounce to /login).
  const session = await getSession();
  if (session && session.role !== "COO" && session.role !== "DIRECTOR") redirect("/console");

  const ticket = await mintConsoleTicket();
  const sp = await searchParams;
  const okMsg = sp.ok ? OK_MESSAGE[sp.ok] : undefined;
  const errMsg = sp.err ? ERR_MESSAGE[sp.err] : undefined;

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

      {okMsg && (
        <div className="rounded-lg bg-accent-50 px-4 py-2 text-sm text-accent-800 ring-1 ring-accent-200">
          {okMsg}
        </div>
      )}
      {errMsg && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800 ring-1 ring-rose-200">
          {errMsg}
        </div>
      )}

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

      <CreateSeasonForm ticket={ticket} />

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
            {!s.active && <ActivateButton seasonId={s.id} ticket={ticket} />}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">
                Divisions ({s.divisions.length})
              </h3>
              {s.divisions.length === 0 && <StandardDivisionsButton seasonId={s.id} ticket={ticket} />}
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
                      {d._count.registrations === 0 && <DeleteDivisionButton divisionId={d.id} ticket={ticket} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <AddDivisionForm seasonId={s.id} ticket={ticket} />
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
