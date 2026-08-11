import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { AcpEntryForm } from "@/components/AcpEntryForm";
import { acpEntryWindow } from "@/lib/domain/acpEntry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Enter your team — Arizona Club Pickleball" },
  description: "Enter your club team in ACP: name a team contact, list 6–8 players, $195 per player.",
  alternates: { canonical: "/acp/enter" },
};

export default async function AcpEnterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const window = acpEntryWindow();

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Link href="/acp" className="text-sm text-slate-500 hover:text-brand-700 hover:underline">
          ← Arizona Club Pickleball
        </Link>
        <h1 className="display mt-3 text-3xl text-brand-900 sm:text-4xl">Enter your team</h1>

        {window === "before" && (
          <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50/50 p-6">
            <h2 className="text-lg font-bold text-brand-900">Entries open September 14</h2>
            <p className="mt-1 text-sm text-slate-600">
              The entry form opens <strong>September 14</strong> and closes <strong>October 12</strong>.{" "}
              <Link href="/acp" className="font-medium text-brand-700 hover:underline">
                Join the interest list
              </Link>{" "}
              and we&apos;ll email you the moment it opens.
            </p>
          </div>
        )}

        {window === "closed" && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-bold text-slate-900">Entries are closed</h2>
            <p className="mt-1 text-sm text-slate-600">
              Entries closed October 12. Questions about a late entry?{" "}
              <a href="mailto:team@purepickleball.com" className="font-medium text-brand-700 hover:underline">
                Email us
              </a>
              .
            </p>
          </div>
        )}

        {window === "open" &&
          (sp.ok ? (
            <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-800">
              <p className="text-base font-semibold">Entry received — thank you!</p>
              <p className="mt-1">
                We&apos;ve emailed your team contact a confirmation with the total and a secure payment link. Your
                place is confirmed once payment clears. Divisions run with a minimum of four teams; if yours is
                short, we&apos;ll be in touch about consolidating with an adjacent band.
              </p>
              <p className="mt-3">
                <Link href="/acp" className="font-medium text-emerald-900 underline">Back to ACP</Link>
              </p>
            </div>
          ) : (
            <>
              <p className="mt-2 text-slate-600">
                Name a team contact, list your roster, and submit. $195 per player, {" "}
                <span className="whitespace-nowrap">6–8 players</span> per team.
              </p>
              <AcpEntryForm err={sp.err} detail={sp.detail} />
            </>
          ))}
      </div>
      <SiteFooter />
    </div>
  );
}
