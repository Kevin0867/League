import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";

export const dynamic = "force-dynamic";

export const metadata = {
  title: { absolute: "Request a Lesson or Clinic — PURE Academy" },
  description: "Tell us what you're looking for — a private lesson, a semi-private session, or a group clinic — and a PURE Academy coach coordinator will be in touch.",
  alternates: { canonical: "/clinics/request" },
};

const TYPES = [
  { value: "PRIVATE", label: "Private lesson (1-on-1)" },
  { value: "SEMI_PRIVATE", label: "Semi-private (2–3 players)" },
  { value: "CLINIC", label: "Group clinic" },
  { value: "UNSURE", label: "Not sure yet — help me decide" },
];
const SKILLS = ["New to pickleball", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0+"];

export default async function ClinicRequestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const submitted = sp.ok === "1";

  return (
    <div>
      <PublicNav />

      <section className="border-b border-brand-100 bg-gradient-to-br from-brand-900 via-brand-800 to-brand-950 text-white">
        <div className="mx-auto max-w-3xl px-4 py-14">
          <p className="eyebrow eyebrow-light mb-4">PURE Academy</p>
          <h1 className="display text-4xl text-white sm:text-5xl">Request a lesson or clinic</h1>
          <p className="mt-5 max-w-xl text-lg text-brand-100">
            Don&apos;t see a session that fits? Tell us what you&apos;re after and we&apos;ll match you with the right coach, location, and time.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-12">
        {submitted ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
            <h2 className="text-2xl font-bold text-emerald-900">Request received!</h2>
            <p className="mt-2 text-emerald-800">
              Thanks — a coach coordinator will reach out soon to set you up. We&apos;ve emailed you a confirmation too.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <Link href="/clinics" className="btn-secondary text-sm">Back to clinics</Link>
              <Link href="/" className="btn-accent text-sm">PURE Academy home</Link>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            {sp.err === "fields" && (
              <div className="mb-4 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">Please add your name and a valid email so we can reach you.</div>
            )}
            <form method="POST" action="/api/clinics/request" className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="name">Your name *</label>
                  <input id="name" name="name" required className="input" placeholder="First and last" />
                </div>
                <div>
                  <label className="label" htmlFor="email">Email *</label>
                  <input id="email" name="email" type="email" required className="input" placeholder="you@email.com" />
                </div>
                <div>
                  <label className="label" htmlFor="phone">Phone</label>
                  <input id="phone" name="phone" type="tel" className="input" placeholder="(480) 555-0100" />
                </div>
                <div>
                  <label className="label" htmlFor="skillLevel">Skill level</label>
                  <select id="skillLevel" name="skillLevel" className="input" defaultValue="">
                    <option value="">Select…</option>
                    {SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">What are you looking for?</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TYPES.map((t, i) => (
                    <label key={t.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                      <input type="radio" name="requestType" value={t.value} defaultChecked={i === 0} className="accent-brand-600" />
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="locations">Preferred locations</label>
                  <input id="locations" name="locations" className="input" placeholder="e.g. Gilbert, Mesa" />
                </div>
                <div>
                  <label className="label" htmlFor="preferredTimes">Preferred days/times</label>
                  <input id="preferredTimes" name="preferredTimes" className="input" placeholder="e.g. weekday evenings" />
                </div>
              </div>

              <div>
                <label className="label" htmlFor="notes">Anything else?</label>
                <textarea id="notes" name="notes" rows={3} className="input" placeholder="Goals, who's playing, questions…" />
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">We&apos;ll only use this to set up your coaching.</p>
                <button className="btn-accent">Send request</button>
              </div>
            </form>
          </div>
        )}
      </section>
      <SiteFooter />
    </div>
  );
}
