import Link from "next/link";
import { requireStaff } from "@/lib/rbac";
import { PageHeader } from "@/components/RoadmapNote";
import { REUSABLE_FORMS } from "@/lib/domain/coachingForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coaching Forms" };

// The digital "Reusable Forms" from the Coaches Workbook. Built ones open; the
// rest are coming soon.
export default async function CoachingFormsPage() {
  await requireStaff();
  return (
    <div className="space-y-5">
      <PageHeader title="Coaching Forms" subtitle="The workbook's reusable forms, made digital. Trackers save each player's numbers so you can see progress over the season." />
      <div className="grid gap-3 sm:grid-cols-2">
        {REUSABLE_FORMS.map((f) =>
          f.built ? (
            <Link key={f.slug} href={`/console/forms/${f.slug}`} className="card block transition hover:border-brand-300 hover:shadow">
              <div className="font-semibold text-slate-900">{f.title}</div>
              <p className="mt-0.5 text-sm text-slate-600">{f.desc}</p>
              <div className="mt-2 text-xs font-semibold text-brand-700">Open →</div>
            </Link>
          ) : (
            <div key={f.slug} className="card opacity-70">
              <div className="font-semibold text-slate-700">{f.title}</div>
              <p className="mt-0.5 text-sm text-slate-500">{f.desc}</p>
              <div className="mt-2 text-xs font-medium text-slate-400">Coming soon</div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
