import Link from "next/link";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { ACADEMY_MARKETS } from "@/lib/enums";

export const dynamic = "force-dynamic";

const SKILLS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0+"];
const DAY_TIMES = [
  "Weekday mornings",
  "Weekday afternoons",
  "Weekday evenings",
  "Weekend mornings",
  "Weekend afternoons",
];

export default async function LessonsPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  const session = await requireUser();
  const ticket = await mintConsoleTicket();
  const me = session.personId
    ? await prisma.person.findUnique({ where: { id: session.personId } })
    : null;
  const fullName = me ? `${me.firstName} ${me.lastName}` : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lessons &amp; clinics</h1>
          <p className="text-slate-500">Tell us what you&apos;re looking for and our team will follow up.</p>
        </div>
        <Link href="/portal" className="btn-ghost text-sm">← Portal</Link>
      </div>

      {sent && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Thanks! Your request was sent to our team. We&apos;ll be in touch soon.
        </div>
      )}

      <form method="POST" action="/api/portal" className="card space-y-6">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="requestLesson" />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Your name</label>
            <input name="contactName" className="input" defaultValue={fullName} required />
          </div>
          <div>
            <label className="label">Email</label>
            <input name="contactEmail" type="email" className="input" defaultValue={me?.email ?? ""} required />
          </div>
          <div>
            <label className="label">Phone</label>
            <input name="contactPhone" type="tel" className="input" defaultValue={me?.phone ?? ""} />
          </div>
          <div>
            <label className="label">Who is this for?</label>
            <select name="forWho" className="input" defaultValue="Just me">
              <option>Just me</option>
              <option>Me and others</option>
              <option>Someone else</option>
            </select>
          </div>
          <div>
            <label className="label">Skill / rating</label>
            <select name="rating" className="input" defaultValue="">
              <option value="">Not sure / new</option>
              {SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Lesson type</label>
            <select name="lessonType" className="input" defaultValue="No preference">
              <option>No preference</option>
              <option>Private</option>
              <option>Semi-private</option>
              <option>Clinic</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Preferred location(s)</label>
          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-2">
            {ACADEMY_MARKETS.map((loc) => (
              <label key={loc} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="location" value={loc} /> {loc}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Day / time preferences</label>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {DAY_TIMES.map((dt) => (
              <label key={dt} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="dayTime" value={dt} /> {dt}
              </label>
            ))}
          </div>
          <input name="dayTimeOther" className="input mt-2" placeholder="Other / specific times (optional)" />
        </div>

        <div>
          <label className="label">What would you like to work on? <span className="text-slate-400">(optional)</span></label>
          <textarea name="notes" rows={3} className="input" placeholder="Goals, how long you've played, anything else we should know…" />
        </div>

        <button type="submit" className="btn-primary">Send request</button>
      </form>
    </div>
  );
}
