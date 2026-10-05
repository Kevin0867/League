import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatDateTime12 } from "@/lib/time";
import { acpEntryWindow } from "@/lib/domain/acpEntry";
import { DIVISION_MIN_TEAMS } from "@/lib/domain/seasonCalendar";
import { mintConsoleTicket } from "@/lib/auth";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { requireAdmin } from "@/lib/rbac";
import { buildAcpCrossReference } from "@/lib/domain/acpCrossReference";

// Admin view of ACP outside-club interest (Phase A) and entries (Phase B).
// Groups entries by division so staff can see which divisions clear the
// four-team minimum and which need consolidating (build-list item 1).
export const dynamic = "force-dynamic";

const WINDOW_LABEL: Record<string, string> = {
  before: "Entries open Sept 14",
  open: "Entries open now",
  closed: "Entries closed",
};

export default async function ConsoleAcpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const [interests, entries] = await Promise.all([
    prisma.acpInterest.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.acpEntry.findMany({
      orderBy: { createdAt: "desc" },
      include: { players: { orderBy: { createdAt: "asc" } } },
    }),
  ]);

  const window = acpEntryWindow();
  const paid = entries.filter((e) => e.status === "PAID").length;
  const revenue = entries.reduce((n, e) => n + e.amountDueCents, 0);
  const xref = await buildAcpCrossReference();

  // Group entries by division to check the four-team minimum.
  const byDivision = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = e.divisionName || "Unspecified";
    (byDivision.get(key) ?? byDivision.set(key, []).get(key)!).push(e);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Arizona Club Pickleball</h1>
          <p className="text-slate-500">Outside-club interest and team entries.</p>
        </div>
        <span className="badge bg-brand-100 text-brand-800 self-center">{WINDOW_LABEL[window]}</span>
      </div>

      {sp.ok === "requested" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">Payment request created.</p>
          <p className="mt-1">{sp.cpunsent ? "Email didn't complete — copy the pay link and send it directly:" : "We emailed a secure pay link. You can also copy it:"}</p>
          {sp.pid && <div className="mt-2"><CopyLinkButton path={`/pay/${sp.pid}`} label="Copy pay link" /></div>}
        </div>
      )}
      {(sp.err === "cpname" || sp.err === "cpemail" || sp.err === "cpamount") && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">Check the payment details and try again.</div>
      )}

      {/* Cross-reference: ACP signups who are already active Academy players (so
          they're in ACP via their Academy membership and shouldn't be charged). */}
      <div className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Already in ACP via Academy</h2>
          <span className="text-xs text-slate-500">{xref.academyCount} active Academy players on file</span>
        </div>
        <p className="mt-0.5 text-sm text-slate-500">
          Active Academy players are automatically in ACP through their Academy registration. These ACP signups match an
          Academy player by email — they&apos;re already in and shouldn&apos;t be charged to join. Matching is by email across
          club entries and ACP charges (filed or imported from Stripe).
        </p>

        {xref.alreadyIn === 0 ? (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            No ACP signups match an active Academy player. Nothing to reconcile.
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-800"><strong>{xref.alreadyIn}</strong> ACP signup{xref.alreadyIn === 1 ? "" : "s"} already in via Academy</span>
              {xref.alreadyInChargedCents > 0 && <span className="rounded-lg bg-rose-50 px-3 py-1.5 text-rose-800"><strong>{formatCents(xref.alreadyInChargedCents)}</strong> collected from already-in players — review for refund</span>}
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-1.5 pr-3">ACP signup</th>
                    <th className="py-1.5 pr-3">Email</th>
                    <th className="py-1.5 pr-3">Seen in</th>
                    <th className="py-1.5 pr-3">Charged</th>
                    <th className="py-1.5">Academy player</th>
                  </tr>
                </thead>
                <tbody>
                  {xref.people.filter((p) => p.academy).map((p) => (
                    <tr key={p.key} className="border-b border-slate-100">
                      <td className="py-1.5 pr-3 font-medium text-slate-800">{p.name ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-slate-500">{p.email ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-xs text-slate-500">{p.sources.join(", ")}</td>
                      <td className="py-1.5 pr-3">{p.chargedCents > 0 ? <span className="font-semibold text-rose-700">{formatCents(p.chargedCents)}</span> : <span className="text-slate-400">—</span>}</td>
                      <td className="py-1.5">
                        <Link href={`/console/people/${p.academy!.personId}`} className="text-brand-700 hover:underline">{p.academy!.name}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Charges shown as collected should be refunded if these players paid to join ACP separately — they&apos;re covered by their Academy membership. (Unfiled Stripe imports are matched too; file them on Payments to set the ACP category.)
            </p>
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Interest sign-ups" value={interests.length} />
        <Metric label="Team entries" value={entries.length} />
        <Metric label="Paid" value={paid} />
        <Metric label="Entry fees (submitted)" value={formatCents(revenue)} />
      </div>

      {/* Entries by division */}
      <div className="card">
        <h2 className="font-semibold text-slate-900">Entries by division</h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-500">
          Each division runs with a minimum of {DIVISION_MIN_TEAMS} teams. Short divisions consolidate with an
          adjacent band.
        </p>
        {entries.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">No entries yet.</p>
        ) : (
          <div className="space-y-4">
            {[...byDivision.entries()].map(([division, list]) => {
              const short = list.length < DIVISION_MIN_TEAMS;
              return (
                <div key={division}>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">{division}</h3>
                    <span className={`badge ${short ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                      {list.length} {list.length === 1 ? "team" : "teams"}{short ? ` · needs ${DIVISION_MIN_TEAMS - list.length} more` : " · clears minimum"}
                    </span>
                  </div>
                  <ul className="mt-2 divide-y divide-slate-100 text-sm">
                    {list.map((e) => (
                      <li key={e.id}>
                        <Link href={`/console/acp/${e.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2 -mx-2 hover:bg-slate-50">
                          <div>
                            <span className="font-medium text-brand-700">{e.clubName}</span>
                            <span className="text-slate-400"> · {e.playerCount} players · {formatCents(e.amountDueCents)}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            <span>{e.contactName} · {e.contactEmail}</span>
                            <StatusBadge status={e.status} />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* All entries — click into any to edit, manage the roster, request the
          fee, or convert it to a team. */}
      {entries.length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-900">All entries</h2>
          <ul className="divide-y divide-slate-100">
            {entries.map((e) => (
              <li key={e.id}>
                <Link href={`/console/acp/${e.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2.5 -mx-2 hover:bg-slate-50">
                  <div>
                    <span className="font-medium text-brand-700">{e.clubName}</span>
                    <span className="text-slate-400"> — {e.divisionName} · {e.players.length} players · {formatCents(e.amountDueCents)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>{e.contactName}</span>
                    <StatusBadge status={e.status} />
                    <span className="text-brand-600">Manage →</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Interest list */}
      <div className="card">
        <h2 className="mb-3 font-semibold text-slate-900">Interest list (pre-entry)</h2>
        {interests.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">No interest sign-ups yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Club</th>
                  <th className="py-2 pr-4">Contact</th>
                  <th className="py-2 pr-4">Market</th>
                  <th className="py-2 pr-4">Teams</th>
                  <th className="py-2 pr-4">Divisions</th>
                  <th className="py-2 pr-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {interests.map((i) => (
                  <tr key={i.id} className="align-top">
                    <td className="whitespace-nowrap py-2 pr-4 text-slate-500">{formatDateTime12(i.createdAt)}</td>
                    <td className="py-2 pr-4 font-medium text-slate-700">{i.clubName}</td>
                    <td className="py-2 pr-4 text-slate-500">{i.contactName} · {i.email}</td>
                    <td className="py-2 pr-4 text-slate-500">{i.market ?? "—"}</td>
                    <td className="py-2 pr-4 text-slate-500">{i.likelyTeams ?? "—"}</td>
                    <td className="py-2 pr-4 text-slate-500">{i.likelyDivisions ?? "—"}</td>
                    <td className="py-2 pr-4 text-right">
                      <form method="POST" action="/api/console/acp">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="interestToEntry" />
                        <input type="hidden" name="interestId" value={i.id} />
                        <button className="btn-chip-brand whitespace-nowrap">Create entry →</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-3xl font-extrabold text-brand-700 tabular-nums">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "PAID"
      ? "bg-emerald-100 text-emerald-800"
      : status === "WITHDRAWN"
      ? "bg-slate-200 text-slate-600"
      : status === "CONFIRMED"
      ? "bg-sky-100 text-sky-800"
      : "bg-amber-100 text-amber-800";
  return <span className={`badge ${cls}`}>{status.toLowerCase()}</span>;
}
