import Link from "next/link";
import { formatDate } from "@/lib/time";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { decryptField } from "@/lib/crypto";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

// Minors' data, medical disclosures, and emergency contacts are access-controlled
// (§17/§18). Only staff who manage players (COO / Director) may view them; coaches
// see their own roster elsewhere, without medical/emergency detail.
export default async function PersonDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.role, "managePlayers")) redirect("/console");
  const ticket = await mintConsoleTicket();

  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      registrations: { include: { division: true } },
      teamMemberships: { include: { team: true } },
      guardian: true,
      dependents: true,
      waivers: { orderBy: { signedAt: "desc" }, take: 1 },
    },
  });
  if (!person) notFound();

  // Decrypt sensitive fields for this authorized view only.
  const emergencyName = decryptField(person.emergencyName);
  const emergencyPhone = decryptField(person.emergencyPhone);
  const emergencyRelation = decryptField(person.emergencyRelation);
  const medicalNotes = decryptField(person.medicalNotes);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/console/registrations" className="text-sm text-brand-600 hover:underline">← Registrations</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{person.firstName} {person.lastName}</h1>
          {person.isMinor && <span className="badge bg-amber-100 text-amber-800">minor</span>}
          {person.waiverSignedAt
            ? <span className="badge bg-emerald-100 text-emerald-800">waiver signed</span>
            : <span className="badge bg-rose-100 text-rose-800">no waiver</span>}
        </div>
      </div>

      {sp.ok === "personedit" && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved.</div>}
      {sp.err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{sp.err === "fields" ? "First and last name are required." : "Couldn't save — please try again."}</div>}

      {/* Admin edit — name (coaches included), contact, birthdate, and the
          protected emergency/medical fields, all in one place. */}
      <details className="card">
        <summary className="cursor-pointer font-semibold text-slate-900">Edit this record</summary>
        <form method="POST" action="/api/console/people" className="mt-4 space-y-4">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="editPerson" />
          <input type="hidden" name="personId" value={person.id} />
          <input type="hidden" name="returnTo" value={`/console/people/${person.id}`} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">First name</label><input name="firstName" className="input" defaultValue={person.firstName} required /></div>
            <div><label className="label">Last name</label><input name="lastName" className="input" defaultValue={person.lastName} required /></div>
            <div><label className="label">Email</label><input name="email" type="email" className="input" defaultValue={person.email ?? ""} /></div>
            <div><label className="label">Phone</label><input name="phone" type="tel" className="input" defaultValue={person.phone ?? ""} /></div>
            <div><label className="label">Date of birth</label><input name="dob" type="date" className="input" defaultValue={person.dob ? new Date(person.dob).toISOString().slice(0, 10) : ""} /></div>
          </div>
          <div className="rounded-lg border-l-4 border-brand-300 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Protected — encrypted at rest</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label className="label">Emergency contact name</label><input name="emergencyName" className="input" defaultValue={emergencyName ?? ""} /></div>
              <div><label className="label">Relationship</label><input name="emergencyRelation" className="input" defaultValue={emergencyRelation ?? ""} /></div>
              <div><label className="label">Emergency phone</label><input name="emergencyPhone" type="tel" className="input" defaultValue={emergencyPhone ?? ""} /></div>
            </div>
            <div className="mt-3"><label className="label">Medical disclosures</label><textarea name="medicalNotes" rows={2} className="input" defaultValue={medicalNotes ?? ""} /></div>
          </div>
          <button className="btn-primary">Save changes</button>
        </form>
      </details>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-900">Contact</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Email" value={person.email} />
            <Row label="Phone" value={person.phone} />
            <Row label="Date of birth" value={person.dob ? formatDate(person.dob) : null} />
            {person.guardian && <Row label="Guardian" value={`${person.guardian.firstName} ${person.guardian.lastName}`} />}
            {person.dependents.length > 0 && <Row label="Dependents" value={person.dependents.map((dpt) => `${dpt.firstName} ${dpt.lastName}`).join(", ")} />}
          </dl>
        </div>

        {/* Protected: emergency + medical (decrypted for authorized staff) */}
        <div className="card border-l-4 border-brand-300 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-semibold text-slate-900">Protected information</h2>
            <span className="badge bg-brand-100 text-brand-800">🔒 encrypted at rest</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">Emergency contact</h3>
              {emergencyName ? (
                <p className="mt-1 text-sm text-slate-800">
                  {emergencyName}{emergencyRelation ? ` (${emergencyRelation})` : ""}<br />
                  <span className="text-slate-500">{emergencyPhone ?? "—"}</span>
                </p>
              ) : <p className="mt-1 text-sm text-slate-400">Not on file.</p>}
            </div>
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">Medical disclosures</h3>
              <p className="mt-1 text-sm text-slate-800">{medicalNotes ?? <span className="text-slate-400">None disclosed.</span>}</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Stored AES-256-GCM encrypted; decrypted only for this authorized view. Access is
            limited to the COO and Academy Director.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 font-semibold text-slate-900">Registrations</h2>
          {person.registrations.length === 0 ? <p className="text-sm text-slate-400">None.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {person.registrations.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <span className="text-slate-700">{r.division?.name ?? "Unplaced"}</span>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2 className="mb-2 font-semibold text-slate-900">Teams</h2>
          {person.teamMemberships.length === 0 ? <p className="text-sm text-slate-400">None.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {person.teamMemberships.map((m) => (
                <li key={m.id} className="py-2 text-slate-700">{m.team.name}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right text-slate-700">{value ?? "—"}</dd>
    </div>
  );
}
