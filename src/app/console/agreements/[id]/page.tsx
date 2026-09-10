import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AgreementDocument } from "@/components/AgreementDocument";
import { coachAssignmentForAgreement, type AgreementAssignment } from "@/lib/domain/coachingAgreement";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coaching Agreement" };

export default async function AgreementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  const rec = await prisma.coachingAgreement.findUnique({
    where: { id },
    include: { coach: { select: { id: true, person: { select: { firstName: true, lastName: true, email: true, phone: true } } } } },
  });
  if (!rec) notFound();

  const coachName = rec.coachName ?? `${rec.coach.person.firstName} ${rec.coach.person.lastName}`.trim();
  const assignment: AgreementAssignment = rec.assignment
    ? (rec.assignment as unknown as AgreementAssignment)
    : await coachAssignmentForAgreement(rec.coach.id);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/console/agreements" className="btn-back">← All agreements</Link>

      {sp.ok === "countersigned" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          ✓ Countersigned — the agreement is fully executed. The coach has been notified and both of you have a copy.
        </div>
      )}
      {sp.err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {sp.err === "fields" ? "Enter your name and type your signature to countersign." : sp.err === "state" ? "This agreement isn't awaiting countersignature." : "Something went wrong — try again."}
        </div>
      )}

      <AgreementDocument
        coachName={coachName}
        coachEmail={rec.coachEmail}
        coachPhone={rec.coachPhone}
        assignment={assignment}
        coachSig={rec.status !== "SENT" ? { name: rec.coachName, signature: rec.coachSignature, at: rec.coachSignedAt } : null}
        adminSig={rec.status === "COUNTERSIGNED" ? { name: rec.adminName, title: rec.adminTitle, at: rec.adminSignedAt } : null}
      />

      {rec.status === "COACH_SIGNED" && (
        <form method="POST" action="/api/console/coaching-agreement" className="card space-y-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="adminCountersign" />
          <input type="hidden" name="agreementId" value={rec.id} />
          <h3 className="text-sm font-bold uppercase tracking-wide text-brand-800">Countersign for PURE</h3>
          <p className="text-sm text-slate-600">Countersigning on behalf of PURE Pickleball &amp; Padel executes this agreement. Your typed name is your signature.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Your name</label><input name="adminName" className="input" defaultValue={session.name} required /></div>
            <div><label className="label">Title</label><input name="adminTitle" className="input" placeholder="e.g. Academy Director" /></div>
          </div>
          <div><label className="label">Signature (type your full name)</label><input name="signature" className="input" defaultValue={session.name} required /></div>
          <button className="btn-primary">Countersign &amp; execute</button>
        </form>
      )}
    </div>
  );
}
