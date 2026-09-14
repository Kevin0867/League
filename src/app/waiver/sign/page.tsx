import Link from "next/link";
import { prisma } from "@/lib/db";
import { verifyWaiverToken } from "@/lib/domain/waiverRenewal";
import { WAIVER_VERSION } from "@/components/WaiverText";
import { Logo } from "@/components/Brand";
import { WaiverSignForm } from "./WaiverSignForm";

export const dynamic = "force-dynamic";

// Public, no-login waiver signing from an admin-sent link. The token in the URL
// is the capability (proves which person it's for). Handles both an adult
// signing for themselves and a parent/guardian signing on behalf of a minor.
const ERRORS: Record<string, string> = {
  token: "This link is invalid or has expired. Please contact us for a new one.",
  agree: "Please check the box to agree before signing.",
  name: "Please type the full legal name to sign.",
  guardianemail: "Please enter the parent/guardian email so we can reach you about your player.",
  gender: "Please select a gender for everyone on the waiver.",
  server: "Something went wrong saving your waiver. Please try again, or contact us if it keeps happening.",
};

export default async function WaiverSignPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; done?: string; err?: string; next?: string }>;
}) {
  const sp = await searchParams;

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Logo />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/pure-pickleball-padel.png" alt="PURE Pickleball & Padel" className="h-9 w-auto" />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10">{children}</main>
    </div>
  );

  if (sp.done === "1") {
    return (
      <Shell>
        <div className="card text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl">✓</div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Waiver signed</h1>
          <p className="mt-1 text-slate-600">Thank you — the signed waiver is on file. You&apos;re all set.</p>
          <Link href="/" className="btn-primary mt-6">Back to PURE Academy</Link>
        </div>
      </Shell>
    );
  }

  const personId = await verifyWaiverToken(sp.token);
  const person = personId ? await prisma.person.findUnique({ where: { id: personId } }) : null;

  if (!person) {
    return (
      <Shell>
        <div className="card text-center">
          <h1 className="text-2xl font-bold text-slate-900">Link expired</h1>
          <p className="mt-2 text-slate-600">{ERRORS.token}</p>
        </div>
      </Shell>
    );
  }

  const isMinor = person.isMinor;
  const today = new Date().toISOString().slice(0, 10);

  // One waiver covers the whole household, so we collect gender for the
  // parent/guardian AND every child here — mirroring the sign route's family
  // resolution: from any member's link, resolve up to the paying adult, then
  // list that adult + all dependents.
  const rootId = person.guardianId ?? person.id;
  const root = await prisma.person.findUnique({
    where: { id: rootId },
    select: {
      id: true, firstName: true, lastName: true, gender: true, isMinor: true,
      dependents: { select: { id: true, firstName: true, lastName: true, gender: true }, orderBy: { firstName: "asc" } },
    },
  });
  const hasChildren = (root?.dependents.length ?? 0) > 0;
  const participants = root
    ? [
        { id: root.id, name: `${root.firstName} ${root.lastName}`, gender: root.gender, role: hasChildren ? "parent/guardian" : root.isMinor ? "player" : "player" },
        ...root.dependents.map((d) => ({ id: d.id, name: `${d.firstName} ${d.lastName}`, gender: d.gender, role: "child" })),
      ]
    : [{ id: person.id, name: `${person.firstName} ${person.lastName}`, gender: person.gender, role: isMinor ? "child" : "player" }];

  return (
    <Shell>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">
          {isMinor ? `Sign the waiver for ${person.firstName}` : `Sign your waiver, ${person.firstName}`}
        </h1>
        <p className="mt-1 text-slate-600">
          {isMinor
            ? `${person.firstName} is a minor, so a parent or guardian must read and sign the participation waiver below on their behalf.`
            : "Please read and sign the PURE Academy participation waiver below before your first session."}
        </p>
      </div>

      {sp.err && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {ERRORS[sp.err] ?? "Something went wrong."}
        </p>
      )}

      <WaiverSignForm
        token={sp.token ?? ""}
        waiverVersion={WAIVER_VERSION}
        next={sp.next}
        today={today}
        isMinor={isMinor}
        personFirstName={person.firstName}
        personEmail={person.email ?? ""}
        personPhone={person.phone ?? ""}
        participants={participants.map((m) => ({ id: m.id, name: m.name, gender: m.gender ?? null, role: m.role }))}
      />

      <p className="mt-4 text-center text-sm text-slate-500">
        Having trouble signing here?{" "}
        <a href={`/waiver/print${sp.token ? `?token=${encodeURIComponent(sp.token)}` : ""}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 underline">
          Print or save the waiver to sign by hand
        </a>{" "}
        and give it to your coach.
      </p>
    </Shell>
  );
}
