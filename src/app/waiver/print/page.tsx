import { prisma } from "@/lib/db";
import { verifyWaiverToken } from "@/lib/domain/waiverRenewal";
import { WaiverText } from "@/components/WaiverText";
import { PrintButton } from "@/components/PrintButton";
import { Logo } from "@/components/Brand";

export const dynamic = "force-dynamic";
export const metadata = { title: "Participation waiver" };

// A print-friendly copy of the participation waiver, for anyone who has trouble
// completing the online form. They can save it as a PDF or print it, sign by
// hand, and hand it to a coach to record. Signing online stays the fastest way.
export default async function WaiverPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;

  // If a token is present, name the household on the printed form; otherwise
  // leave the name lines blank to fill in by hand.
  const personId = sp.token ? await verifyWaiverToken(sp.token) : null;
  const person = personId ? await prisma.person.findUnique({ where: { id: personId } }) : null;
  const rootId = person ? person.guardianId ?? person.id : null;
  const root = rootId
    ? await prisma.person.findUnique({
        where: { id: rootId },
        select: { firstName: true, lastName: true, dependents: { select: { firstName: true, lastName: true }, orderBy: { firstName: "asc" } } },
      })
    : null;
  const names = root
    ? [`${root.firstName} ${root.lastName}`.trim(), ...root.dependents.map((d) => `${d.firstName} ${d.lastName}`.trim())]
    : [];

  const Line = ({ label }: { label: string }) => (
    <div className="mt-6">
      <div className="border-b border-slate-400 pb-6" />
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-3xl px-5 py-8 print:px-0 print:py-0">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Logo />
          <PrintButton />
        </div>

        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 print:hidden">
          Trouble signing online? Save or print this page, sign it by hand, and give it to your coach — they can record it for you.
          Signing online is still the fastest way, if you can.
        </div>

        <h1 className="mt-6 text-center text-xl font-bold text-slate-900">
          PURE Pickleball &amp; Padel — Participation Waiver
        </h1>

        <div className="mt-5 text-sm leading-relaxed text-slate-800">
          <WaiverText />
        </div>

        <section className="mt-8 border-t border-slate-300 pt-6">
          <p className="text-sm font-semibold text-slate-800">Signature</p>
          {names.length > 0 && (
            <p className="mt-1 text-sm text-slate-600">
              Covers: {names.join(", ")}.
            </p>
          )}
          <Line label="Participant name(s) — printed" />
          <Line label="Signature (participant, or parent/guardian for a minor)" />
          <div className="grid gap-6 sm:grid-cols-2">
            <Line label="Printed name of signer" />
            <Line label="Date" />
          </div>
        </section>

        <p className="mt-8 text-center text-xs text-slate-400 print:mt-4">
          PURE Pickleball &amp; Padel · Return a signed copy to your coach or the front office.
        </p>
      </main>
    </div>
  );
}
