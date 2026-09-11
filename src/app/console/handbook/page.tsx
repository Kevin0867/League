import Link from "next/link";
import { requireStaff } from "@/lib/rbac";
import { REUSABLE_FORMS } from "@/lib/domain/coachingForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coaches Workbook" };

// The PURE Academy Coaches Workbook, served as its original PDF so the exact
// formatting is preserved. A prominent "Open" button works reliably on mobile
// (opens the phone's native PDF viewer); an inline viewer is shown for larger
// screens. Any staff member can read it.
const PDF = "/docs/coaches-workbook.pdf";

export default async function HandbookPage() {
  await requireStaff();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/console/today" className="btn-back">← Today</Link>

      <header className="rounded-xl border border-brand-200 bg-brand-50 px-5 py-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">PURE Pickleball &amp; Padel — Scottsdale</div>
        <h1 className="mt-0.5 text-2xl font-bold text-slate-900">Coaches Workbook</h1>
        <p className="text-sm text-slate-600">Tap to open the full document.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={PDF} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm">📘 Open the workbook (PDF)</a>
          <a href={PDF} download className="btn-secondary text-sm">Download</a>
        </div>
      </header>

      {/* Digital versions of the workbook's Reusable Forms. */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-brand-800">Digital forms</h2>
        <p className="mt-0.5 text-xs text-slate-500">Fill these out in the app instead of printing — trackers save each player&apos;s numbers over the season.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {REUSABLE_FORMS.map((f) =>
            f.built ? (
              <Link key={f.slug} href={`/console/forms/${f.slug}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-brand-700 hover:border-brand-300 hover:bg-brand-50">
                {f.title} →
              </Link>
            ) : (
              <span key={f.slug} className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-400">{f.title} · soon</span>
            )
          )}
        </div>
        <Link href="/console/forms" className="mt-3 inline-block text-xs font-semibold text-brand-700 hover:underline">All coaching forms →</Link>
      </section>

      {/* Inline viewer — great on desktop/tablet. On phones, the "Open" button
          above launches the native PDF viewer, which is the most reliable path. */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <object data={PDF} type="application/pdf" className="h-[75vh] w-full">
          <div className="p-6 text-center text-sm text-slate-500">
            Your browser can&apos;t show the PDF inline.{" "}
            <a href={PDF} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline">Tap here to open the workbook.</a>
          </div>
        </object>
      </div>

      <p className="pb-4 text-center text-xs text-slate-400">
        PURE Pickleball &amp; Padel — Scottsdale · Coaches Workbook · Confidential
      </p>
    </div>
  );
}
