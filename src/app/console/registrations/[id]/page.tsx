import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { decryptField } from "@/lib/crypto";

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
};
const ERR: Record<string, string> = {
  notassigned: "This player isn't on a team yet — assign them first.",
  nopayment: "No outstanding fee to resend.",
  fields: "Missing information.",
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

        <button type="submit" className="btn-primary">Save changes</button>
      </form>

      {/* Read-only intake + location prefs */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-900">Intake &amp; preferences</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Location preferences" value={reg.locationPrefs.map((l) => l.facility?.name ?? l.marketName).filter(Boolean).join(" › ") || "—"} />
          <Row label="Submitted" value={reg.submittedAt ? reg.submittedAt.toISOString().slice(0, 10) : "—"} />
          <Row label="Per-class rate" value={reg.perClassRateCents != null ? formatCents(reg.perClassRateCents) : "—"} />
          <Row label="Enrollment fee" value={reg.enrollmentFeeCents != null ? formatCents(reg.enrollmentFeeCents) : "—"} />
          <Row label="Source status" value={reg.sourceStatus ?? "—"} />
          <Row label="Stripe customer" value={p.stripeCustomerId ?? "—"} />
          <Row label="Stripe subscription" value={reg.stripeSubscriptionId ?? "—"} />
          <Row label="Waiver" value={p.waiverSignedAt ? `signed ${p.waiverSignedAt.toISOString().slice(0, 10)}` : "outstanding"} />
        </dl>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right font-medium text-slate-700">{value}</dd>
    </div>
  );
}
