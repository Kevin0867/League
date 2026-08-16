import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { formatCents } from "@/lib/money";
import { listPublicClinics, formatClinicWhen } from "@/lib/domain/clinics";

export const dynamic = "force-dynamic";

export const metadata = {
  title: { absolute: "Clinics & Private Coaching — PURE Academy" },
  description: "Private lessons, semi-private sessions, and skill clinics with PURE Academy coaches across the Valley.",
  alternates: { canonical: "/clinics" },
};

export default async function ClinicsPage() {
  const clinics = await listPublicClinics();

  return (
    <div>
      <PublicNav />

      <section className="border-b border-brand-100 bg-gradient-to-br from-brand-900 via-brand-800 to-brand-950 text-white">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <p className="eyebrow eyebrow-light mb-4">PURE Academy</p>
          <h1 className="display text-4xl text-white sm:text-5xl">Clinics &amp; group sessions</h1>
          <p className="mt-5 max-w-xl text-lg text-brand-100">
            Drop into a focused session with a PURE coach. Reserve your spot online — pay to confirm, no account required.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/clinics/request" className="btn-accent">Request a lesson or clinic</Link>
            <span className="text-sm text-brand-100">Don&apos;t see a fit? Tell us what you need and we&apos;ll set it up.</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12">
        {clinics.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <p className="text-lg font-semibold text-slate-800">No clinics on the calendar right now</p>
            <p className="mt-2 text-slate-500">
              <Link href="/clinics/request" className="text-brand-600 underline">Request a lesson or clinic</Link> and we&apos;ll set one up, or <Link href="/register" className="text-brand-600 underline">register for the season</Link> to join a team.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {clinics.map((c) => (
              <div key={c.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-xl font-bold text-slate-900">{c.title}</h2>
                  <span className="whitespace-nowrap rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-700">
                    {formatCents(c.priceCents)}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-600">{formatClinicWhen(c.scheduledAt)}</p>
                <p className="text-sm text-slate-500">
                  {c.facilityName}{c.coachName ? ` · Coach ${c.coachName}` : ""}
                </p>
                {c.description && <p className="mt-3 line-clamp-3 text-sm text-slate-600">{c.description}</p>}

                <div className="mt-4 flex items-center justify-between gap-3 pt-2">
                  <span className={`text-sm font-medium ${c.isFull ? "text-rose-600" : "text-emerald-700"}`}>
                    {c.isFull ? "Full" : `${c.spotsLeft} of ${c.capacity} spots left`}
                  </span>
                  {c.isFull ? (
                    <span className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-400">Sold out</span>
                  ) : (
                    <Link href={`/clinics/${c.id}`} className="btn-accent px-4 py-2 text-sm">Sign up</Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <SiteFooter />
    </div>
  );
}
