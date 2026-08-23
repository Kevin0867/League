import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/RoadmapNote";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { formatCents } from "@/lib/money";
import { ScopePicker } from "./ScopePicker";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  auth: "Not signed in.",
  perm: "You don't have permission for that.",
  fields: "Please fill in the required fields.",
  notfound: "Not found.",
  op: "Unknown operation.",
};

const SCOPE_LABEL: Record<string, string> = { LEAGUE: "League", TOURNAMENT: "Tournament", TEAM: "Team", ORG: "Organization" };
const STATUS_STYLE: Record<string, string> = {
  PROSPECT: "bg-slate-100 text-slate-700",
  COMMITTED: "bg-amber-100 text-amber-800",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  DECLINED: "bg-rose-100 text-rose-700",
  ARCHIVED: "bg-slate-100 text-slate-400",
};
const STATUSES = ["PROSPECT", "COMMITTED", "ACTIVE", "DECLINED", "ARCHIVED"];

export default async function SponsorshipsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session || !can(session.role, "manageTeams")) redirect("/console");
  const ticket = await mintConsoleTicket();

  const [benefits, sponsors, packages, deals, seasons, teams] = await Promise.all([
    prisma.sponsorBenefit.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.sponsor.findMany({ orderBy: { name: "asc" } }),
    prisma.sponsorshipPackage.findMany({ include: { benefitLinks: { include: { benefit: true } } }, orderBy: [{ scopeType: "asc" }, { sortOrder: "asc" }] }),
    prisma.sponsorship.findMany({ include: { sponsor: true, package: true }, orderBy: { createdAt: "desc" } }),
    prisma.season.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
    prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const seasonName = new Map(seasons.map((s) => [s.id, s.name]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const scopeLabel = (scopeType: string, scopeId: string | null) => {
    if (scopeType === "ORG") return "Whole organization";
    const n = scopeType === "TEAM" ? teamName.get(scopeId ?? "") : seasonName.get(scopeId ?? "");
    return `${SCOPE_LABEL[scopeType] ?? scopeType}${n ? ` · ${n}` : ""}`;
  };
  const activeBenefits = benefits.filter((b) => b.active);
  const hidden = (op: string, extra?: Record<string, string>) => (
    <>
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value={op} />
      {extra && Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sponsorships"
        subtitle="Sell sponsorships at the league, tournament, and team levels. Teams can source and secure their own sponsors. Everything a sponsor gets is a customizable benefit — rename, add, or remove any of them below."
      />

      {sp.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Saved.</p>}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>}

      {/* ---- Benefit catalog ---- */}
      <section id="benefits" className="card">
        <h2 className="font-semibold text-slate-900">Sponsor benefits — what sponsors get</h2>
        <p className="mt-0.5 text-sm text-slate-500">Your customizable menu of value. These feed the packages you sell. Edit the wording, switch any off, or add your own — nothing here is fixed.</p>

        <ul className="mt-4 divide-y divide-slate-100">
          {benefits.map((b) => (
            <li key={b.id} className="py-2">
              <details>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <span className={`text-sm ${b.active ? "text-slate-800" : "text-slate-400 line-through"}`}>{b.label}</span>
                  <span className="flex items-center gap-2">
                    {!b.active && <span className="badge bg-slate-100 text-slate-500">off</span>}
                    <span className="text-xs text-brand-600">Edit</span>
                  </span>
                </summary>
                <div className="mt-2 space-y-2 pl-1">
                  <form method="POST" action="/api/console/sponsorships" className="space-y-2">
                    {hidden("benefitUpdate", { id: b.id })}
                    <input name="label" defaultValue={b.label} className="input" />
                    <input name="description" defaultValue={b.description ?? ""} placeholder="Short description (optional)" className="input" />
                    <button className="btn-primary text-xs">Save</button>
                  </form>
                  <div className="flex flex-wrap items-center gap-2">
                    <form method="POST" action="/api/console/sponsorships">
                      {hidden("benefitToggle", { id: b.id })}
                      <button className="btn-secondary text-xs">{b.active ? "Turn off" : "Turn on"}</button>
                    </form>
                    <ConfirmSubmit action="/api/console/sponsorships" fields={{ ticket, op: "benefitDelete", id: b.id }} confirm={`Remove "${b.label}" from the benefit menu?`} label="Remove" className="btn-secondary text-xs" danger />
                  </div>
                </div>
              </details>
            </li>
          ))}
          {benefits.length === 0 && <li className="py-2 text-sm text-slate-400">No benefits yet — add your first below.</li>}
        </ul>

        <form method="POST" action="/api/console/sponsorships" className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
          {hidden("benefitCreate")}
          <label className="min-w-[16rem] flex-1">
            <span className="label">Add a benefit</span>
            <input name="label" placeholder="e.g. Logo on the championship banner" className="input" required />
          </label>
          <input name="description" placeholder="Description (optional)" className="input min-w-[12rem] flex-1" />
          <button className="btn-primary text-sm">Add</button>
        </form>
      </section>

      {/* ---- Sponsors ---- */}
      <section id="sponsors" className="card">
        <h2 className="font-semibold text-slate-900">Sponsors</h2>
        <p className="mt-0.5 text-sm text-slate-500">The companies and people sponsoring. Add them once, then attach them to a league, tournament, or team.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400"><tr><th className="py-1">Sponsor</th><th>Contact</th><th>Website</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {sponsors.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 font-medium text-slate-800">{s.name}</td>
                  <td className="text-slate-500">{[s.contactName, s.email, s.phone].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="text-slate-500">{s.website ?? "—"}</td>
                  <td className="text-right"><ConfirmSubmit action="/api/console/sponsorships" fields={{ ticket, op: "sponsorDelete", id: s.id }} confirm={`Delete sponsor "${s.name}"? Their sponsorships are removed too.`} label="Delete" className="btn-secondary text-xs" danger /></td>
                </tr>
              ))}
              {sponsors.length === 0 && <tr><td colSpan={4} className="py-2 text-sm text-slate-400">No sponsors yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <form method="POST" action="/api/console/sponsorships" className="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-3">
          {hidden("sponsorCreate")}
          <input name="name" placeholder="Sponsor name *" className="input" required />
          <input name="contactName" placeholder="Contact name" className="input" />
          <input name="email" type="email" placeholder="Contact email" className="input" />
          <input name="phone" placeholder="Phone" className="input" />
          <input name="website" placeholder="Website" className="input" />
          <div className="flex items-end"><button className="btn-primary w-full text-sm">Add sponsor</button></div>
        </form>
      </section>

      {/* ---- Packages ---- */}
      <section id="packages" className="card">
        <h2 className="font-semibold text-slate-900">Sponsorship packages</h2>
        <p className="mt-0.5 text-sm text-slate-500">Priced tiers you offer at a level (e.g. a league “Gold” or a team “Jersey sponsor”). Pick which benefits each package includes.</p>

        <ul className="mt-3 space-y-2">
          {packages.map((p) => (
            <li key={p.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-slate-800">{p.name}</span>
                  <span className="ml-2 text-sm text-slate-500">{formatCents(p.priceCents)}{p.inventory != null ? ` · ${p.inventory} available` : ""}</span>
                  <div className="text-xs text-slate-400">{scopeLabel(p.scopeType, p.scopeId)}{p.active ? "" : " · inactive"}</div>
                </div>
                <ConfirmSubmit action="/api/console/sponsorships" fields={{ ticket, op: "packageDelete", id: p.id }} confirm={`Delete package "${p.name}"?`} label="Delete" className="btn-secondary text-xs" danger />
              </div>
              {p.benefitLinks.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.benefitLinks.map((bl) => <span key={bl.id} className="badge bg-brand-50 text-brand-700">{bl.benefit.label}</span>)}
                </div>
              )}
            </li>
          ))}
          {packages.length === 0 && <li className="text-sm text-slate-400">No packages yet.</li>}
        </ul>

        <details className="mt-4 border-t border-slate-100 pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ Create a package</summary>
          <form method="POST" action="/api/console/sponsorships" className="mt-3 space-y-3">
            {hidden("packageCreate")}
            <div className="grid gap-2 sm:grid-cols-3">
              <input name="name" placeholder="Package name * (e.g. Gold)" className="input sm:col-span-1" required />
              <input name="price" placeholder="Price (e.g. 1000)" className="input" />
              <input name="inventory" type="number" min="0" placeholder="Qty available (optional)" className="input" />
            </div>
            <ScopePicker seasons={seasons} teams={teams} />
            <input name="description" placeholder="Description (optional)" className="input" />
            <div>
              <span className="label">Included benefits</span>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {activeBenefits.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="benefitIds" value={b.id} /> {b.label}
                  </label>
                ))}
                {activeBenefits.length === 0 && <span className="text-sm text-slate-400">Add benefits above first.</span>}
              </div>
            </div>
            <button className="btn-primary text-sm">Create package</button>
          </form>
        </details>
      </section>

      {/* ---- Deals ---- */}
      <section id="deals" className="card">
        <h2 className="font-semibold text-slate-900">Sponsorships</h2>
        <p className="mt-0.5 text-sm text-slate-500">Sponsors you’ve secured (or are pursuing), by level. Track status and amount.</p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400"><tr><th className="py-1">Sponsor</th><th>Level</th><th>Package</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {deals.map((d) => (
                <tr key={d.id}>
                  <td className="py-2 font-medium text-slate-800">{d.sponsor.name}</td>
                  <td className="text-slate-500">{scopeLabel(d.scopeType, d.scopeId)}</td>
                  <td className="text-slate-500">{d.package?.name ?? (d.benefitsNote ? "Custom" : "—")}</td>
                  <td className="text-slate-600">{d.amountCents ? formatCents(d.amountCents) : "—"}</td>
                  <td>
                    <form method="POST" action="/api/console/sponsorships" className="flex items-center gap-1">
                      {hidden("sponsorshipUpdate", { id: d.id })}
                      <select name="status" defaultValue={d.status} className={`badge border-0 ${STATUS_STYLE[d.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
                      </select>
                      <button className="text-xs text-brand-600 hover:underline">save</button>
                    </form>
                  </td>
                  <td className="text-right"><ConfirmSubmit action="/api/console/sponsorships" fields={{ ticket, op: "sponsorshipDelete", id: d.id }} confirm={`Delete this sponsorship?`} label="Delete" className="btn-secondary text-xs" danger /></td>
                </tr>
              ))}
              {deals.length === 0 && <tr><td colSpan={6} className="py-2 text-sm text-slate-400">No sponsorships recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <details className="mt-4 border-t border-slate-100 pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ Record a sponsorship</summary>
          {sponsors.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">Add a sponsor first.</p>
          ) : (
            <form method="POST" action="/api/console/sponsorships" className="mt-3 space-y-3">
              {hidden("sponsorshipCreate")}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Sponsor</span>
                  <select name="sponsorId" className="input" required>
                    {sponsors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="label">Package (optional)</span>
                  <select name="packageId" className="input">
                    <option value="">— custom / none —</option>
                    {packages.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatCents(p.priceCents)}</option>)}
                  </select>
                </label>
              </div>
              <ScopePicker seasons={seasons} teams={teams} />
              <div className="grid gap-2 sm:grid-cols-2">
                <input name="amount" placeholder="Amount (e.g. 1000)" className="input" />
                <label className="block">
                  <span className="label">Status</span>
                  <select name="status" defaultValue="PROSPECT" className="input">{STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
                </label>
              </div>
              <input name="benefitsNote" placeholder="Custom benefits / notes for this deal (optional)" className="input" />
              <button className="btn-primary text-sm">Record sponsorship</button>
            </form>
          )}
        </details>
      </section>
    </div>
  );
}
