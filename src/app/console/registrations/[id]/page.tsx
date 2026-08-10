import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { decryptField } from "@/lib/crypto";
import { ACADEMY_MARKETS } from "@/lib/enums";

// Sensitive fields are encrypted at rest and only decrypted for staff here.
// A key mismatch yields a marker — show blank so we never re-save the marker.
function dec(v: string | null): string {
  if (!v) return "";
  const d = decryptField(v);
  return d === "[unable to decrypt]" ? "" : d;
}

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  edit: "Registration saved.",
  resent: "Notification resent.",
  assign: "Player assigned.",
  fee: "Season fee requested.",
  refund: "Refund started.",
  waiverSent: "Waiver request emailed.",
};
const ERR: Record<string, string> = {
  notassigned: "This player isn't on a team yet — assign them first.",
  nopayment: "No outstanding fee to resend.",
  fields: "Missing information.",
  noemail: "No email on file for this player — add one before sending the waiver.",
};

const STATUSES = ["SUBMITTED", "ASSIGNED", "WAITLISTED", "WITHDRAWN", "DUPLICATE"];
const GENDERS = ["", "Male", "Female"];

export default async function RegistrationDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  const reg = await prisma.registration.findUnique({
    where: { id },
    include: {
      person: true,
      division: true,
      season: { include: { divisions: { orderBy: { name: "asc" }, select: { id: true, name: true } } } },
      locationPrefs: { orderBy: { rank: "asc" }, include: { facility: true } },
    },
  });
  if (!reg) redirect("/console/registrations?err=notfound");

  const p = reg.person;
  const [teams, membership, payments] = await Promise.all([
    prisma.team.findMany({ where: { seasonId: reg.seasonId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.teamMember.findFirst({ where: { personId: p.id, team: { seasonId: reg.seasonId } }, include: { team: true } }),
    prisma.payment.findMany({ where: { partyId: p.id, seasonId: reg.seasonId }, orderBy: { createdAt: "desc" } }),
  ]);
  const outstanding = payments.find((x) => x.category === "PLAYER_FEE" && ["REQUESTED", "PENDING"].includes(x.status));
  const paid = payments.find((x) => x.category === "PLAYER_FEE" && x.status === "PAID");
  const raw = (reg.importRaw && typeof reg.importRaw === "object" ? reg.importRaw : null) as Record<string, string> | null;

  const currentMarkets = reg.locationPrefs.map((l) => l.marketName ?? l.facility?.market ?? "").filter(Boolean);
  const marketOptions = Array.from(new Set([...ACADEMY_MARKETS, ...currentMarkets]));
  const dollars = (c: number | null | undefined) => (c != null ? (c / 100).toFixed(2) : "");

  const hidden = (
    <>
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="personId" value={p.id} />
      <input type="hidden" name="registrationId" value={reg.id} />
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/console/registrations" className="text-sm text-slate-500 hover:underline">← Registrations</Link>
          <h1 className="text-2xl font-bold text-slate-900">{p.firstName} {p.lastName}</h1>
          <p className="text-sm text-slate-500">{reg.season?.name} · <StatusBadge status={reg.status} /></p>
        </div>
      </div>
      {sp.ok && OK[sp.ok] && <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">{OK[sp.ok]}</p>}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERR[sp.err] ?? "Something went wrong."}</p>}

      {/* Team & fee actions */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-900">Placement &amp; payments</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Team</p>
            <p className="text-sm font-medium text-slate-800">{membership?.team?.name ?? "Unassigned"}</p>
            <form method="POST" action="/api/console/registrations" className="mt-2 flex gap-2">
              {hidden}
              <input type="hidden" name="op" value="assignToTeam" />
              <select name="teamId" defaultValue={membership?.teamId ?? ""} className="input py-1 text-sm">
                <option value="">— Select a team —</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="btn-primary py-1 text-xs whitespace-nowrap">{membership ? "Move" : "Assign"}</button>
            </form>
            {membership && (
              <div className="mt-2 flex gap-3">
                <form method="POST" action="/api/console/registrations">
                  {hidden}<input type="hidden" name="op" value="unassign" />
                  <button className="text-xs text-slate-500 hover:underline">Send back to pool</button>
                </form>
                <form method="POST" action="/api/console/registrations">
                  {hidden}<input type="hidden" name="op" value="resendAssignment" />
                  <button className="text-xs text-brand-700 hover:underline">Resend assignment email</button>
                </form>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Season fee</p>
            <p className="text-sm font-medium text-slate-800">
              {paid ? `Paid ${formatCents(paid.amountCents)}` : outstanding ? `${outstanding.status.toLowerCase()} · ${formatCents(outstanding.amountCents)}` : "Not requested"}
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              {!outstanding && !paid && (
                <form method="POST" action="/api/console/registrations">
                  {hidden}<input type="hidden" name="op" value="requestFee" />
                  <button className="btn-secondary py-1 text-xs">Request season fee</button>
                </form>
              )}
              {outstanding && (
                <form method="POST" action="/api/console/registrations">
                  {hidden}<input type="hidden" name="op" value="resendPayment" />
                  <button className="text-xs text-brand-700 hover:underline">Resend fee request</button>
                </form>
              )}
              {paid && (
                <form method="POST" action="/api/console/registrations">
                  {hidden}<input type="hidden" name="op" value="refund" />
                  <button className="text-xs text-rose-600 hover:underline">Start refund</button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Editable details */}
      <form method="POST" action="/api/console/registrations" className="card space-y-5">
        {hidden}
        <input type="hidden" name="op" value="editRegistration" />
        <h2 className="font-semibold text-slate-900">Player &amp; registration details</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" name="firstName" defaultValue={p.firstName} />
          <Field label="Last name" name="lastName" defaultValue={p.lastName} />
          <Field label="Email" name="email" type="email" defaultValue={p.email ?? ""} />
          <Field label="Phone" name="phone" type="tel" defaultValue={p.phone ?? ""} />
          <Field label="Date of birth" name="dob" type="date" defaultValue={p.dob ? p.dob.toISOString().slice(0, 10) : ""} />
          <Select label="Gender" name="gender" defaultValue={p.gender ?? ""} options={GENDERS.map((g) => ({ value: g, label: g || "—" }))} />
          <Field label="Address" name="address" defaultValue={p.address ?? ""} />
          <Field label="How heard" name="howHeard" defaultValue={p.howHeard ?? ""} />
          <Field label="Emergency contact" name="emergencyName" defaultValue={dec(p.emergencyName)} />
          <Field label="Emergency phone" name="emergencyPhone" type="tel" defaultValue={dec(p.emergencyPhone)} />
          <div className="sm:col-span-2">
            <label className="label">Medical disclosures</label>
            <textarea name="medical" rows={2} className="input" defaultValue={dec(p.medicalNotes)} />
          </div>
        </div>

        <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
          <Select label="Division" name="divisionId" defaultValue={reg.divisionId ?? ""}
            options={[{ value: "", label: "— Unassigned —" }, ...reg.season!.divisions.map((d) => ({ value: d.id, label: d.name }))]} />
          <Select label="Status" name="status" defaultValue={reg.status} options={STATUSES.map((s) => ({ value: s, label: s }))} />
          <Field label="Skill level" name="skillLevel" defaultValue={reg.skillLevel ?? ""} />
          <Field label="Program interest" name="programInterest" defaultValue={reg.programInterest ?? ""} />
          <Field label="Practice time pref" name="practiceTimePref" defaultValue={reg.practiceTimePref ?? ""} />
          <Field label="Schedule" name="schedule" defaultValue={reg.schedule ?? ""} />
          <Field label="Days that don't work" name="daysThatDontWork" defaultValue={reg.daysThatDontWork ?? ""} />
          <div className="sm:col-span-2">
            <label className="label">Notes / partner requests / comments</label>
            <textarea name="partnerRequests" rows={2} className="input" defaultValue={reg.partnerRequests ?? ""} />
          </div>
        </div>

        {/* Intake & preferences — editable */}
        <div className="border-t border-slate-100 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Intake &amp; preferences</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((rank) => (
              <div key={rank}>
                <label className="label">Location #{rank}</label>
                <select name={`locationPref${rank}`} defaultValue={currentMarkets[rank - 1] ?? ""} className="input">
                  <option value="">—</option>
                  {marketOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Per-class rate ($)" name="perClassRate" type="number" defaultValue={dollars(reg.perClassRateCents)} />
            <Field label="Enrollment fee ($)" name="enrollmentFee" type="number" defaultValue={dollars(reg.enrollmentFeeCents)} />
            <Field label="Source status" name="sourceStatus" defaultValue={reg.sourceStatus ?? ""} />
            <Field label="Submitted date" name="submittedAt" type="date" defaultValue={reg.submittedAt ? reg.submittedAt.toISOString().slice(0, 10) : ""} />
            <Field label="Stripe customer ID" name="stripeCustomerId" defaultValue={p.stripeCustomerId ?? ""} />
            <Field label="Stripe subscription ID" name="stripeSubscriptionId" defaultValue={reg.stripeSubscriptionId ?? ""} />
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" name="waiverSigned" defaultChecked={!!p.waiverSignedAt} />
            <span>Waiver on file{p.waiverSignedAt ? ` (signed ${p.waiverSignedAt.toISOString().slice(0, 10)})` : ""}</span>
          </label>
        </div>

        <button type="submit" className="btn-primary">Save changes</button>
      </form>

      {/* Waiver request — email a no-login signing link to the player/parent. */}
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Participation waiver</h2>
          <p className="text-sm text-slate-500">
            {p.waiverSignedAt
              ? `On file — signed ${p.waiverSignedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`
              : p.isMinor
                ? "Not on file. Sends a link for a parent/guardian to sign on this minor's behalf."
                : "Not on file. Sends the player a link to complete their waiver."}
          </p>
        </div>
        <form method="POST" action="/api/console/registrations">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="sendWaiver" />
          <input type="hidden" name="personId" value={p.id} />
          <input type="hidden" name="registrationId" value={reg.id} />
          <button className="btn-secondary text-sm">
            {p.waiverSignedAt ? "Resend waiver link" : "Send waiver request"}
          </button>
        </form>
      </div>

      {raw && (
        <details className="card">
          <summary className="cursor-pointer font-semibold text-slate-900">Original enrollment data ({Object.keys(raw).length} fields)</summary>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {Object.entries(raw).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-slate-50 py-1">
                <dt className="text-slate-400">{k}</dt>
                <dd className="text-right text-slate-700">{String(v) || "—"}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
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

function Select({ label, name, defaultValue, options }: { label: string; name: string; defaultValue?: string; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue} className="input">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

