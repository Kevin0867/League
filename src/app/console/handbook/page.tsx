import Link from "next/link";
import { requireStaff } from "@/lib/rbac";
import { HANDBOOK, HANDBOOK_META } from "@/lib/domain/coachHandbook";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coaching Handbook" };

// The PURE Coaching Handbook & Agreement, rendered as a clean, mobile-friendly
// page (no PDF/Word download). Any staff member can read it.
export default async function HandbookPage() {
  await requireStaff();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/console/today" className="btn-back">← Today</Link>

      <header className="rounded-xl border border-brand-200 bg-brand-50 px-5 py-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">{HANDBOOK_META.org}</div>
        <h1 className="mt-0.5 text-2xl font-bold text-slate-900">{HANDBOOK_META.title}</h1>
        <p className="text-sm text-slate-600">{HANDBOOK_META.subtitle}</p>
        <p className="mt-1 text-xs text-slate-400">{HANDBOOK_META.effective}</p>
      </header>

      {HANDBOOK.map((section) => (
        <section key={section.title} className="card">
          <h2 className="text-lg font-bold text-slate-900">{section.title}</h2>
          <div className="mt-2 space-y-2.5">
            {section.blocks.map((blk, i) =>
              blk.kind === "bullet" ? (
                <div key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                  <span>{blk.text}</span>
                </div>
              ) : blk.kind === "check" ? (
                <div key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                  <span aria-hidden className="shrink-0 text-slate-400">☐</span>
                  <span>{blk.text}</span>
                </div>
              ) : (
                <p key={i} className="text-sm leading-relaxed text-slate-700">{blk.text}</p>
              )
            )}
          </div>
        </section>
      ))}

      <p className="pb-4 text-center text-xs text-slate-400">
        PURE Pickleball &amp; Padel — Scottsdale · Coaching Handbook · Confidential
      </p>
    </div>
  );
}
