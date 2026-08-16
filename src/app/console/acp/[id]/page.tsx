import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { requireAdmin } from "@/lib/rbac";
import { formatCents } from "@/lib/money";
import { formatDateTime12 } from "@/lib/time";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { CustomPaymentForm } from "@/components/CustomPaymentForm";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  saved: "Entry saved.",
  created: "Entry created — add the roster below.",
  playeradded: "Player added.",
  playerremoved: "Player removed.",
};
const ERR: Record<string, string> = {
  name: "Enter the player's name.",
  noseason: "No active ACP league season — create the league first.",
  op: "Unknown action.",
};

const STATUSES = ["SUBMITTED", "CONFIRMED", "PAID", "WITHDRAWN"];

export default async function AcpEntryDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  const entry = await prisma.acpEntry.findUnique({
    where: { id },
    include: { players: { orderBy: { createdAt: "asc" } } },
  });
  if (!entry) redirect("/console/acp?err=notfound");

  // If this club+division already has a team this season, link straight to it.
  const existingTeam = entry.seasonId
    ? await prisma.team.findFirst({
        where: { seasonId: entry.seasonId, origin: "ACP_CLUB", clubName: entry.clubName },
        select: { id: true, name: true, published: true },
      })
    : null;

  const hidden = (
    <>
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="entryId" value={entry.id} />
    </>
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/console/acp" className="text-sm text-slate-500 hover:underline">← Arizona Club Pickleball</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{entry.clubName}</h1>
          <span className="badge bg-slate-100 text-slate-600">{entry.status.toLowerCase()}</span>
        </div>
        <p className="text-sm text-slate-500">{entry.divisionName} · {entry.players.length} players · submitted {formatDateTime12(entry.createdAt)}</p>
      </div>

      {sp.ok && OK[sp.ok] && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{OK[sp.ok]}</p>}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERR[sp.err] ?? "Something went wrong."}</p>}

      {/* Convert to team — the handoff into league setup */}
      <div className="card border-l-4 border-brand-500">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-brand-900">Turn this entry into a team</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              Creates a team (this club, this division) with the roster below, ready to publish and add to the league.
            </p>
          </div>
          {existingTeam ? (
            <Link href={`/console/teams/${existingTeam.id}`} className="btn-secondary text-sm">Open team →</Link>
          ) : (
            <ConfirmSubmit
              action="/api/console/acp"
              fields={{ ticket, op: "convertToTeam", entryId: entry.id }}
              confirm={`Create a team for "${entry.clubName}" (${entry.divisionName}) with its ${entry.players.length} player(s)?`}
              label="Convert to team"
              className="btn-primary text-sm"
            />
          )}
        </div>
        {existingTeam && (
          <p className="mt-2 text-xs text-slate-500">A team for this club already exists: <span className="font-medium">{existingTeam.name}</span>{existingTeam.published ? " (published)" : " (not yet published)"}.</p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Entry fields */}
        <form method="POST" action="/api/console/acp" className="card space-y-4">
          {hidden}
          <input type="hidden" name="op" value="updateEntry" />
          <h2 className="font-semibold text-slate-900">Entry details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Club name" name="clubName" defaultValue={entry.clubName} />
            <Field label="Division" name="divisionName" defaultValue={entry.divisionName} />
            <Field label="Market / city" name="market" defaultValue={entry.market ?? ""} />
            <Select label="Status" name="status" defaultValue={entry.status} options={STATUSES} />
            <Field label="Contact name" name="contactName" defaultValue={entry.contactName} />
            <Field label="Contact email" name="contactEmail" type="email" defaultValue={entry.contactEmail} />
            <Field label="Contact phone" name="contactPhone" type="tel" defaultValue={entry.contactPhone ?? ""} />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea name="notes" rows={2} className="input" defaultValue={entry.notes ?? ""} />
          </div>
          <button className="btn-primary text-sm">Save entry</button>
        </form>

        {/* Roster */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-900">Roster ({entry.players.length})</h2>
          {entry.players.length === 0 ? (
            <p className="text-sm text-slate-400">No players yet. Add them below.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {entry.players.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <span className="font-medium text-slate-800">{p.name}</span>
                    {p.duprRating != null && <span className="text-slate-400"> · DUPR {p.duprRating.toFixed(2)}</span>}
                    {p.email && <span className="block text-xs text-slate-400">{p.email}</span>}
                  </span>
                  <form method="POST" action="/api/console/acp">
                    {hidden}
                    <input type="hidden" name="op" value="removePlayer" />
                    <input type="hidden" name="playerId" value={p.id} />
                    <button className="text-xs text-rose-600 hover:underline">remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {/* Add player */}
          <form method="POST" action="/api/console/acp" className="space-y-2 border-t border-slate-100 pt-3">
            {hidden}
            <input type="hidden" name="op" value="addPlayer" />
            <div className="grid gap-2 sm:grid-cols-2">
              <input name="name" className="input text-sm" placeholder="Player name *" required />
              <input name="email" type="email" className="input text-sm" placeholder="Email (optional)" />
              <input name="duprRating" type="number" step="0.01" min="2" max="8" className="input text-sm" placeholder="DUPR (optional)" />
            </div>
            <button className="btn-secondary text-sm">Add player</button>
          </form>
        </div>
      </div>

      {/* Request the entry fee */}
      <div className="card">
        <h2 className="font-semibold text-slate-900">Request the entry fee</h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-500">Emails {entry.contactName} a secure card link. $195 per player is the standard entry fee.</p>
        <CustomPaymentForm
          ticket={ticket}
          returnTo={`/console/acp/${entry.id}`}
          category="ACP_ENTRY"
          defaults={{
            name: entry.contactName,
            email: entry.contactEmail,
            description: `${entry.clubName} — ACP entry (${entry.divisionName})`,
            amount: (Math.max(1, entry.players.length) * 195).toFixed(2),
          }}
        />
      </div>

      {/* Danger zone */}
      <div className="card border border-rose-200">
        <h2 className="font-semibold text-rose-700">Remove entry</h2>
        <p className="mt-1 text-sm text-slate-600">Deletes this ACP entry and its roster. If you already converted it to a team, that team is not affected. This can&apos;t be undone.</p>
        <div className="mt-3">
          <ConfirmSubmit
            action="/api/console/acp"
            fields={{ ticket, op: "deleteEntry", entryId: entry.id }}
            confirm={`Delete ${entry.clubName}'s ACP entry? This can't be undone.`}
            label="Remove entry"
            className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700"
          />
        </div>
      </div>
    </div>
  );
}

function Field({ label, name, type = "text", defaultValue }: { label: string; name: string; type?: string; defaultValue?: string }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} defaultValue={defaultValue} className="input" />
    </div>
  );
}

function Select({ label, name, defaultValue, options }: { label: string; name: string; defaultValue?: string; options: string[] }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue} className="input">
        {options.map((o) => <option key={o} value={o}>{o.toLowerCase()}</option>)}
      </select>
    </div>
  );
}
