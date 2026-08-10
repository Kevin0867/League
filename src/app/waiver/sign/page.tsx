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
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="mediaOptOut" className="mt-0.5" />
          <span>I do <strong>not</strong> consent to the use of photos/videos (Photo/Video Release opt-out).</span>
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
        <button type="submit" className="btn-primary">Sign waiver</button>
      </form>
    </Shell>
  );
}
