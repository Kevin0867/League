import Link from "next/link";
import { requireStaff } from "@/lib/rbac";

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
        <p className="text-sm text-slate-600">The coaching handbook &amp; agreement. Tap to open the full document.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={PDF} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm">📘 Open the workbook (PDF)</a>
          <a href={PDF} download className="btn-secondary text-sm">Download</a>
        </div>
      </header>

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
