import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { formatDate, formatDateRange } from "@/lib/time";
import { redirect } from "next/navigation";
import {
  CreateSeasonForm,
  ActivateButton,
  StandardDivisionsButton,
  AddDivisionForm,
  EditSeasonForm,
  SeasonFeeForm,
  DeleteSeasonButton,
  EditableDivision,
} from "./SetupForms";

export const dynamic = "force-dynamic";

const OK_MESSAGE: Record<string, string> = {
  createSeason: "Season created.",
  editSeason: "Season updated.",
  deleteSeason: "Season deleted.",
  activateSeason: "Season activated.",
  addDivision: "Division added.",
  editDivision: "Division updated.",
  deleteDivision: "Division removed.",
  addStandardDivisions: "Standard divisions added.",
  setFee: "Season fee updated.",
  setApparel: "Team apparel prices updated.",
};

const ERR_MESSAGE: Record<string, string> = {
  auth: "You are not authorized to manage season setup.",
  fields: "Please fill in the required fields.",
  notfound: "Season not found.",
  hasregistrations: "Can't delete something that has registrations.",
  season: "A season is required.",
  op: "Unknown action.",
};

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const fmt = (d: Date) => formatDate(d);

// Describe the registration window state for a season, from opensOn/closesOn.
function regWindowState(s: { opensOn: Date | null; closesOn: Date | null; active: boolean }) {
  const now = new Date();
  if (!s.active) return "inactive" as const;
  if (s.opensOn && s.opensOn > now) return "scheduled" as const;
  if (s.closesOn && s.closesOn < now) return "closed" as const;
  return "open" as const;
}
function regWindowLabel(s: { opensOn: Date | null; closesOn: Date | null; active: boolean }) {
  switch (regWindowState(s)) {
    case "inactive": return "Closed — season is inactive";
    case "scheduled": return `Opens ${fmt(s.opensOn!)}${s.closesOn ? ` · closes ${fmt(s.closesOn)}` : ""}`;
    case "closed": return `Closed ${fmt(s.closesOn!)}`;
    default: return s.closesOn ? `Open until ${fmt(s.closesOn)}` : "Open (no close date)";
  }
}
function regWindowTone(s: { opensOn: Date | null; closesOn: Date | null; active: boolean }) {
  const st = regWindowState(s);
  if (st === "open") return "text-emerald-700";
  if (st === "scheduled") return "text-amber-700";
  return "text-slate-500";
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  if (session && !["ADMIN", "COO", "DIRECTOR"].includes(session.role)) redirect("/console");

  const ticket = await mintConsoleTicket();
  const sp = await searchParams;
  const okMsg = sp.ok ? OK_MESSAGE[sp.ok] : undefined;
  const errMsg = sp.err ? ERR_MESSAGE[sp.err] : undefined;

  const [seasons, facilityCount, teamCount, rate] = await Promise.all([
    prisma.season.findMany({
      orderBy: [{ active: "desc" }, { startDate: "desc" }],
      include: {
        divisions: { orderBy: { name: "asc" }, include: { _count: { select: { registrations: true } } } },
        _count: { select: { registrations: true } },
      },
    }),
    prisma.facility.count(),
    prisma.team.count(),
    prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } }),
  ]);

  const activeSeason = seasons.find((s) => s.active && s.program === "PURE_ACADEMY");
  const feeCents = rate?.seasonFeeCents ?? 49500;
  const shirtCents = rate?.shirtPriceCents ?? 2500;
  const tankCents = rate?.tankPriceCents ?? 2500;

  // Guided next step — the first incomplete milestone drives the CTA.
  const steps = [
    { done: !!activeSeason, label: "Create & activate a PURE Academy season", href: null, cta: "Create a season below" },
    { done: !!activeSeason && activeSeason.divisions.length > 0, label: "Add divisions to the active season", href: null, cta: "Add divisions below" },
    { done: facilityCount > 0, label: "Set up at least one facility", href: "/console/facilities", cta: "Go to Facilities" },
    { done: teamCount > 0, label: "Build your first team", href: "/console/teams", cta: "Go to Team Build" },
    { done: (activeSeason?._count.registrations ?? 0) > 0, label: "Open registration & collect signups", href: "/register", cta: "View the registration form" },
  ];
  const nextStep = steps.find((s) => !s.done);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Season setup</h1>
        <p className="text-slate-500">
          Set up your season, divisions, and fee. Registration attaches each signup to the{" "}
          <span className="font-medium">active</span> PURE Academy season.
        </p>
      </div>

      {okMsg && <div className="rounded-lg bg-accent-50 px-4 py-2 text-sm text-accent-800 ring-1 ring-accent-200">{okMsg}</div>}
      {errMsg && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800 ring-1 ring-rose-200">{errMsg}</div>}

      {/* Guided next steps */}
      <div className="card border-l-4 border-brand-500">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-brand-900">Setup checklist</h2>
            {nextStep ? (
              <p className="mt-0.5 text-sm text-slate-600">
                Next: <span className="font-medium text-slate-800">{nextStep.label}</span>
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-emerald-700">You&apos;re all set — every step is complete. 🎉</p>
            )}
          </div>
          {nextStep?.href && (
            <Link href={nextStep.href} className="btn-primary text-sm">{nextStep.cta} →</Link>
          )}
        </div>
        <ol className="mt-3 space-y-2 text-sm">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${s.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                {s.done ? "✓" : i + 1}
              </span>
              <span className={s.done ? "text-slate-500 line-through" : "text-slate-700"}>{s.label}</span>
              {!s.done && s.href && (
                <Link href={s.href} className="text-xs text-accent-700 underline">{s.cta}</Link>
              )}
            </li>
          ))}
        </ol>
      </div>

      <CreateSeasonForm ticket={ticket} />

      {seasons.length === 0 && <p className="text-slate-500">No seasons yet — create one to get started.</p>}

      {seasons.map((s) => (
        <div key={s.id} className="card space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold text-brand-900">
                {s.name}{" "}
                {s.active
                  ? <span className="badge bg-accent-100 text-accent-800">Active</span>
                  : <span className="badge bg-slate-100 text-slate-500">Inactive</span>}
              </h2>
              <p className="text-xs text-slate-500">
                {s.program} · {formatDateRange(s.startDate, s.endDate)} · {s._count.registrations} registrations
              </p>
              <p className="mt-0.5 text-xs">
                <span className="font-medium text-slate-600">Registration:</span>{" "}
                <span className={regWindowTone(s)}>{regWindowLabel(s)}</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              {!s.active && <ActivateButton seasonId={s.id} ticket={ticket} />}
              <EditSeasonForm ticket={ticket} season={{ id: s.id, name: s.name, program: s.program, startDate: iso(s.startDate), endDate: iso(s.endDate), opensOn: iso(s.opensOn), closesOn: iso(s.closesOn) }} />
              <DeleteSeasonButton seasonId={s.id} ticket={ticket} disabled={s._count.registrations > 0} />
            </div>
          </div>

          {s.active && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="text-sm">
                <span className="text-slate-500">Season fee</span>{" "}
                <span className="font-semibold text-slate-800">${(feeCents / 100).toFixed(0)}</span>
                <span className="ml-1 text-xs text-slate-400">applies to new fee requests</span>
              </div>
              <SeasonFeeForm ticket={ticket} currentFeeCents={feeCents} />
            </div>
          )}

          {s.active && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="text-sm">
                <span className="text-slate-500">Team apparel</span>{" "}
                <span className="font-semibold text-slate-800">T-shirt ${(shirtCents / 100).toFixed(0)} · Tank ${(tankCents / 100).toFixed(0)}</span>
                <span className="ml-1 text-xs text-slate-400">required with each season-fee payment</span>
              </div>
              <form method="POST" action="/api/console/setup" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="setApparelPrices" />
                <div>
                  <label className="block text-xs font-medium text-slate-500">T-shirt $</label>
                  <input name="shirtPrice" type="number" min={0} step="1" defaultValue={(shirtCents / 100).toFixed(0)} className="input w-24 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500">Tank $</label>
                  <input name="tankPrice" type="number" min={0} step="1" defaultValue={(tankCents / 100).toFixed(0)} className="input w-24 py-1.5 text-sm" />
                </div>
                <button className="btn-secondary text-sm">Save prices</button>
              </form>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Divisions ({s.divisions.length})</h3>
              {s.divisions.length === 0 && <StandardDivisionsButton seasonId={s.id} ticket={ticket} />}
            </div>
            {s.divisions.length > 0 && (
              <ul className="mb-3 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                {s.divisions.map((d) => (
                  <EditableDivision
                    key={d.id}
                    ticket={ticket}
                    division={{ id: d.id, name: d.name, divisionType: d.divisionType, minRating: d.minRating, maxRating: d.maxRating, registrations: d._count.registrations }}
                  />
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
