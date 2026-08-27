import Link from "next/link";
import { prisma } from "@/lib/db";
import { verifyWaiverToken } from "@/lib/domain/waiverRenewal";
import { WaiverText, WAIVER_VERSION } from "@/components/WaiverText";
import { Logo } from "@/components/Brand";

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
};

export default async function WaiverSignPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; done?: string; err?: string }>;
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

      <form method="POST" action="/api/waiver/sign" className="card space-y-4">
        <input type="hidden" name="token" value={sp.token} />
        <input type="hidden" name="waiverVersion" value={WAIVER_VERSION} />
        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
          <WaiverText />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="agree" className="mt-0.5" required />
          <span>
            {isMinor ? (
              <>As {person.firstName}&apos;s parent or guardian, I have read, understand, and agree to the{" "}
              <strong>Acknowledgment of Risk, Waiver, and Release of Liability</strong> above, and I sign it on their behalf freely and voluntarily.</>
            ) : (
              <>I have read, understand, and agree to the{" "}
              <strong>Acknowledgment of Risk, Waiver, and Release of Liability</strong> above, and I sign it freely and voluntarily.</>
            )}
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="signatureName">
              {isMinor ? "Parent/guardian signature (type full legal name)" : "Signature (type full legal name)"}
            </label>
            <input id="signatureName" name="signatureName" className="input" required />
          </div>
          <div>
            <label className="label" htmlFor="date">Date</label>
            <input id="date" type="date" className="input" defaultValue={today} readOnly />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">
            {participants.length > 1 ? "Everyone on this waiver" : "Participant"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Please confirm each person&apos;s gender — it&apos;s used to place players in the correct
            division{participants.length > 1 ? ", including the parent/guardian and each child" : ""}.
          </p>
          <div className="mt-3 space-y-3">
            {participants.map((m) => {
              const g = m.gender === "MALE" || m.gender === "FEMALE" ? m.gender : "";
              return (
                <div key={m.id} className="grid grid-cols-[1fr,auto] items-center gap-3">
                  <div className="text-sm">
                    <span className="font-medium text-slate-800">{m.name}</span>
                    <span className="ml-1.5 text-xs text-slate-400">({m.role})</span>
                  </div>
                  <select name={`gender_${m.id}`} className="input w-40" defaultValue={g} required>
                    <option value="" disabled>Select…</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </select>
                </div>
              );
            })}
          </div>
        </div>

        {isMinor && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">Parent/guardian contact</p>
            <p className="mt-0.5 text-xs text-slate-500">
              We&apos;ll use this to reach you about {person.firstName}&apos;s team, schedule, payments, and weekly
              progress. Required.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="guardianEmail">Parent/guardian email *</label>
                <input id="guardianEmail" name="guardianEmail" type="email" className="input" required
                  defaultValue={person.email ?? ""} placeholder="parent@email.com" />
              </div>
              <div>
                <label className="label" htmlFor="guardianPhone">Parent/guardian phone (optional)</label>
                <input id="guardianPhone" name="guardianPhone" type="tel" className="input"
                  defaultValue={person.phone ?? ""} placeholder="(480) 555-0100" />
              </div>
            </div>
          </div>
        )}

        <button type="submit" className="btn-primary">Sign waiver</button>
      </form>
    </Shell>
  );
}
