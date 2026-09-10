import { ACK_CLAUSES, COMP_TERMS, SEASON_LINE, AGREEMENT_VERSION, type AgreementAssignment } from "@/lib/domain/coachingAgreement";

// Renders the full digital coaching agreement: header, the coach's Appendix A
// assignment (teams / role / day-time / location), the acknowledgment clauses,
// compensation terms, and the two-party signature status. Pure presentational
// (no hooks) so it renders in both the coach and admin server pages.
type Sig = { name?: string | null; signature?: string | null; at?: Date | null; title?: string | null };

export function AgreementDocument({
  coachName,
  coachEmail,
  coachPhone,
  assignment,
  coachSig,
  adminSig,
}: {
  coachName: string;
  coachEmail?: string | null;
  coachPhone?: string | null;
  assignment: AgreementAssignment;
  coachSig?: Sig | null;
  adminSig?: Sig | null;
}) {
  const fmt = (d?: Date | null) => (d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");
  return (
    <div className="space-y-5">
      <header className="rounded-xl border border-brand-200 bg-brand-50 px-5 py-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">PURE Pickleball &amp; Padel — Scottsdale</div>
        <h2 className="mt-0.5 text-xl font-bold text-slate-900">Coaching Agreement</h2>
        <p className="text-sm text-slate-600">Youth, Adult &amp; Academy Programs · {AGREEMENT_VERSION}</p>
      </header>

      {/* Appendix A — the coach's assignment, auto-filled */}
      <section className="card">
        <h3 className="text-sm font-bold uppercase tracking-wide text-brand-800">Appendix A — Assignment &amp; Compensation</h3>
        <dl className="mt-2 space-y-1 text-sm">
          <Row label="Coach" value={coachName} />
          <Row label="Email / phone" value={[coachEmail, coachPhone].filter(Boolean).join(" · ") || "—"} />
          <Row label="Role" value={assignment.roleSummary} />
          <Row label="Season" value={SEASON_LINE} />
        </dl>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr><th className="py-1 pr-3">Team</th><th className="pr-3">Role</th><th className="pr-3">Day / time</th><th>Location</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assignment.teams.length === 0 ? (
                <tr><td colSpan={4} className="py-2 text-slate-400">No teams assigned yet — your assignment appears here once the Academy Director places you.</td></tr>
              ) : assignment.teams.map((t, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-3 font-medium text-slate-800">{t.team}</td>
                  <td className="pr-3 text-slate-600">{t.role}</td>
                  <td className="pr-3 text-slate-600">{t.dayTime}</td>
                  <td className="text-slate-600">{t.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
          {COMP_TERMS.map((c) => (
            <div key={c.item} className="sm:flex sm:gap-2">
              <dt className="shrink-0 font-semibold text-slate-700 sm:w-40">{c.item}</dt>
              <dd>{c.term}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* The acknowledgment clauses */}
      <section className="card">
        <h3 className="text-sm font-bold uppercase tracking-wide text-brand-800">Coach Acknowledgment &amp; Agreement</h3>
        <p className="mt-2 text-xs text-slate-500">
          For contracting purposes, PURE is Pickleball at Riverwalk HoldCo, LLC, DBA PURE Pickleball &amp; Padel — Scottsdale. The
          full handbook is available on the Coaches Workbook page; by signing, Coach agrees to all of it.
        </p>
        <div className="mt-3 space-y-2.5">
          {ACK_CLAUSES.map((c) => (
            <p key={c.title} className="text-sm leading-relaxed text-slate-700"><span className="font-semibold text-slate-900">{c.title}:</span> {c.text}</p>
          ))}
        </div>
      </section>

      {/* Signature status */}
      <section className="card">
        <h3 className="text-sm font-bold uppercase tracking-wide text-brand-800">Signatures</h3>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Coach</div>
            {coachSig?.at ? (
              <>
                <div className="mt-1 font-[cursive] text-lg text-slate-900">{coachSig.signature || coachSig.name}</div>
                <div className="text-xs text-slate-500">{coachSig.name} · signed {fmt(coachSig.at)}</div>
              </>
            ) : <div className="mt-1 text-sm text-slate-400">Not yet signed</div>}
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">PURE Pickleball &amp; Padel</div>
            {adminSig?.at ? (
              <>
                <div className="mt-1 font-[cursive] text-lg text-slate-900">{adminSig.signature || adminSig.name}</div>
                <div className="text-xs text-slate-500">{adminSig.name}{adminSig.title ? `, ${adminSig.title}` : ""} · countersigned {fmt(adminSig.at)}</div>
              </>
            ) : <div className="mt-1 text-sm text-slate-400">Awaiting PURE countersignature</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="sm:flex sm:gap-2">
      <dt className="shrink-0 font-semibold text-slate-700 sm:w-32">{label}</dt>
      <dd className="text-slate-600">{value}</dd>
    </div>
  );
}
