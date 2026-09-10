import Link from "next/link";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AgreementDocument } from "@/components/AgreementDocument";
import { coachAssignmentForAgreement, type AgreementAssignment } from "@/lib/domain/coachingAgreement";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coaching Agreement" };

export default async function CoachAgreementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireStaff();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  const coach = session.personId
    ? await prisma.coach.findUnique({ where: { personId: session.personId }, select: { id: true, person: { select: { firstName: true, lastName: true, email: true, phone: true } } } })
    : null;
  if (!coach) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link href="/console/today" className="btn-back">← Today</Link>
        <div className="card text-sm text-slate-500">The coaching agreement is for coaches. Your account isn&apos;t set up as a coach — contact the Academy Director if that&apos;s unexpected.</div>
      </div>
    );
  }

  const activeSeason = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } })
    ?? await prisma.season.findFirst({ where: { active: true }, select: { id: true } });

  const agreement = await prisma.coachingAgreement.findFirst({
    where: { coachId: coach.id, ...(activeSeason ? { seasonId: activeSeason.id } : {}) },
    orderBy: { createdAt: "desc" },
  });

  const coachName = `${coach.person.firstName} ${coach.person.lastName}`.trim();
  // Signed record uses its frozen snapshot; a draft shows the live assignment.
  const liveAssignment = await coachAssignmentForAgreement(coach.id);
  const assignment: AgreementAssignment =
    agreement?.assignment && agreement.status !== "SENT"
      ? (agreement.assignment as unknown as AgreementAssignment)
      : liveAssignment;
  const signed = !!agreement && agreement.status !== "SENT";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/console/today" className="btn-back">← Today</Link>

      {sp.ok === "signed" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <strong>Signed — thank you.</strong> Your agreement was sent to PURE for countersignature. A copy stays here on your account.
        </div>
      )}
      {sp.err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{sp.err === "agree" ? "Please check the box to agree, and type your name to sign." : "Couldn't submit — please try again."}</div>}

      {agreement?.status === "COUNTERSIGNED" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          ✓ Fully executed — signed by you and countersigned by PURE. This is your copy.
        </div>
      )}
      {agreement?.status === "COACH_SIGNED" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You&apos;ve signed — awaiting PURE&apos;s countersignature. You&apos;ll have the fully-executed copy here once it&apos;s countersigned.
        </div>
      )}

      <AgreementDocument
        coachName={agreement?.coachName ?? coachName}
        coachEmail={agreement?.coachEmail ?? coach.person.email}
        coachPhone={agreement?.coachPhone ?? coach.person.phone}
        assignment={assignment}
        coachSig={agreement && agreement.status !== "SENT" ? { name: agreement.coachName, signature: agreement.coachSignature, at: agreement.coachSignedAt } : null}
        adminSig={agreement?.status === "COUNTERSIGNED" ? { name: agreement.adminName, title: agreement.adminTitle, at: agreement.adminSignedAt } : null}
      />

      {!signed && (
        <form method="POST" action="/api/console/coaching-agreement" className="card space-y-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="coachSign" />
          <input type="hidden" name="returnTo" value="/console/agreement" />
          <h3 className="text-sm font-bold uppercase tracking-wide text-brand-800">Sign the agreement</h3>
          <p className="text-sm text-slate-600">Review your assignment and the terms above. Type your full name to sign — an electronic signature counts as your signature.</p>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" name="agree" value="1" className="mt-1 accent-brand-600" />
            I have read and agree to the PURE Coaching Handbook &amp; Agreement and this assignment.
          </label>
          <div>
            <label className="label">Signature (type your full name)</label>
            <input name="signature" className="input" defaultValue={coachName} required />
          </div>
          <button className="btn-primary">Sign &amp; submit to PURE</button>
        </form>
      )}
    </div>
  );
}
