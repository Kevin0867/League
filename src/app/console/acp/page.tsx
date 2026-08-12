import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatDateTime12 } from "@/lib/time";
import { acpEntryWindow } from "@/lib/domain/acpEntry";
import { DIVISION_MIN_TEAMS } from "@/lib/domain/seasonCalendar";
import { mintConsoleTicket } from "@/lib/auth";
import { CustomPaymentForm } from "@/components/CustomPaymentForm";
import { CopyLinkButton } from "@/components/CopyLinkButton";

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
                      <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div>
                          <span className="font-medium text-slate-800">{e.clubName}</span>
                          <span className="text-slate-400"> · {e.playerCount} players · {formatCents(e.amountDueCents)}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span>{e.contactName} · {e.contactEmail}</span>
                          <StatusBadge status={e.status} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Full entry detail with rosters */}
      {entries.length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-900">All entries</h2>
          <div className="space-y-3">
            {entries.map((e) => (
              <details key={e.id} className="rounded-lg border border-slate-200 p-3">
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium text-slate-800">{e.clubName}</span>
                  <span className="text-slate-400"> — {e.divisionName} · {e.playerCount} players · {formatCents(e.amountDueCents)}</span>
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="text-sm text-slate-600">
                    <div><span className="text-slate-400">Contact:</span> {e.contactName}</div>
                    <div><span className="text-slate-400">Email:</span> {e.contactEmail}</div>
                    {e.contactPhone && <div><span className="text-slate-400">Phone:</span> {e.contactPhone}</div>}
                    {e.market && <div><span className="text-slate-400">Market:</span> {e.market}</div>}
                    <div><span className="text-slate-400">Submitted:</span> {formatDateTime12(e.createdAt)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Roster</div>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-slate-700">
                      {e.players.map((p) => (
                        <li key={p.id}>
                          {p.name}
                          {p.duprRating != null && <span className="text-slate-400"> · DUPR {p.duprRating.toFixed(2)}</span>}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                {/* Request a card payment for this entry — prefilled, discountable */}
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Request payment</div>
                  <div className="mt-2">
                    <CustomPaymentForm
                      ticket={ticket}
                      returnTo="/console/acp"
                      category="ACP_ENTRY"
                      compact
                      defaults={{
                        name: e.contactName,
                        email: e.contactEmail,
                        description: `${e.clubName} — 3 league matches and entry into the Championships`,
                        amount: "195.00",
                      }}
                    />
                  </div>
                </div>
              </details>
            ))}
          </div>
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
