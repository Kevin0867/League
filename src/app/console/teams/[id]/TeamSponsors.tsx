import { prisma } from "@/lib/db";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { formatCents } from "@/lib/money";

// Team-level sponsor sourcing, shown on the team page. A team's coach (or an
// admin) can add a sponsor they've secured for THIS team in one step, and see
// the team's current sponsors. The API re-checks that the actor coaches this
// team, so this is safe to render for any authorized team-page viewer.
const STATUSES = ["PROSPECT", "COMMITTED", "ACTIVE", "DECLINED", "ARCHIVED"];
const STATUS_STYLE: Record<string, string> = {
  PROSPECT: "bg-slate-100 text-slate-700",
  COMMITTED: "bg-amber-100 text-amber-800",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  DECLINED: "bg-rose-100 text-rose-700",
  ARCHIVED: "bg-slate-100 text-slate-400",
};

export async function TeamSponsors({ teamId, ticket }: { teamId: string; ticket: string }) {
  const deals = await prisma.sponsorship.findMany({
    where: { scopeType: "TEAM", scopeId: teamId },
    include: { sponsor: true },
    orderBy: { createdAt: "desc" },
  });
  const returnTo = `/console/teams/${teamId}`;

  return (
    <div id="sponsors" className="card">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Team sponsors</h2>
        {deals.length > 0 && <span className="text-xs text-slate-400">{deals.length} on file</span>}
      </div>
      <p className="mt-0.5 text-sm text-slate-500">Source and secure sponsors for this team. Add one you&apos;ve landed, and it&apos;s tracked here.</p>

      {deals.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {deals.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <span className="font-medium text-slate-800">{d.sponsor.name}</span>
                {d.amountCents > 0 && <span className="ml-2 text-slate-500">{formatCents(d.amountCents)}</span>}
                {d.benefitsNote && <div className="text-xs text-slate-400">{d.benefitsNote}</div>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${STATUS_STYLE[d.status] ?? "bg-slate-100 text-slate-600"}`}>{d.status.toLowerCase()}</span>
                <ConfirmSubmit action="/api/console/sponsorships" fields={{ ticket, op: "sponsorshipDelete", id: d.id, returnTo }} confirm={`Remove ${d.sponsor.name} from this team's sponsors?`} label="Remove" className="btn-secondary text-xs" danger />
              </div>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-3 border-t border-slate-100 pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ Add a team sponsor</summary>
        <form method="POST" action="/api/console/sponsorships" className="mt-3 space-y-2">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="teamSponsorQuickAdd" />
          <input type="hidden" name="teamId" value={teamId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input name="sponsorName" placeholder="Sponsor name *" className="input" required />
            <input name="contactName" placeholder="Contact name" className="input" />
            <input name="email" type="email" placeholder="Contact email" className="input" />
            <input name="phone" placeholder="Phone" className="input" />
            <input name="amount" placeholder="Amount (e.g. 500)" className="input" />
            <select name="status" defaultValue="COMMITTED" className="input">
              {STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
            </select>
          </div>
          <input name="benefitsNote" placeholder="What they get / notes (optional)" className="input" />
          <button className="btn-primary text-sm">Add sponsor</button>
        </form>
      </details>
    </div>
  );
}
