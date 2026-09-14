import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { MediaAttach } from "@/components/MediaAttach";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leave feedback" };

const PHASES = new Set(["MIDSEASON", "ENDSEASON", "GENERAL"]);

export default async function PortalFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const phase = PHASES.has(sp.phase ?? "") ? (sp.phase as string) : "GENERAL";

  // Requires sign-in (a feedback request text links here); bounce logged-out
  // families through login and back to this exact form, phase preserved.
  const session = await getSession();
  if (!session) {
    const dest = `/portal/feedback${phase !== "GENERAL" ? `?phase=${encodeURIComponent(phase)}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(dest)}`);
  }
  const ticket = await mintConsoleTicket();

  // The household: the signed-in person plus their dependents — so a parent can
  // give feedback about any of their kids' coaches.
  const me = session.personId
    ? await prisma.person.findUnique({ where: { id: session.personId }, select: { id: true, dependents: { select: { id: true } } } })
    : null;
  const householdIds = me ? [me.id, ...me.dependents.map((d) => d.id)] : [];

  // The coaches this family actually has (active-season teams they're on), so
  // "about a coach" is a short, relevant pick — not the whole staff.
  const memberships = householdIds.length
    ? await prisma.teamMember.findMany({
        where: { personId: { in: householdIds }, team: { season: { active: true } } },
        select: { team: { select: { coach: { select: { id: true, person: { select: { firstName: true, lastName: true } } } } } } },
      })
    : [];
  const coachMap = new Map<string, string>();
  for (const m of memberships) {
    const c = m.team.coach;
    if (c?.person) coachMap.set(c.id, `${c.person.firstName} ${c.person.lastName}`.trim());
  }
  const coaches = [...coachMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <div>
        <Link href="/portal" className="btn-back">← Back to portal</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Leave feedback</h1>
        <p className="text-sm text-slate-500">Tell us how it&apos;s going — a note for the team, a shout-out for a coach, or anything we should know.</p>
      </div>

      {sp.ok === "1" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Thank you — your feedback was sent. 🎾
          <div className="mt-2"><Link href="/portal" className="font-semibold text-emerald-800 underline">Back to portal</Link></div>
        </div>
      )}
      {sp.err && (
        <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{sp.err === "empty" ? "Please add a note before sending." : "Something went wrong — please try again."}</div>
      )}

      {sp.ok !== "1" && (
        <form method="POST" action="/api/portal/feedback" className="card space-y-4">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="phase" value={phase} />

          <div>
            <label className="label" htmlFor="body">Your feedback</label>
            <textarea id="body" name="body" rows={5} required className="input" placeholder="What went well? Anything we can do better?" />
          </div>

          <div>
            <span className="label">Add a photo or video (optional)</span>
            <MediaAttach label="Add a photo / video" />
          </div>

          {coaches.length > 0 && (
            <div>
              <label className="label" htmlFor="coachId">Is this about a coach? (optional)</label>
              <select id="coachId" name="coachId" defaultValue="" className="input">
                <option value="">Not about a specific coach</option>
                {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <fieldset>
            <span className="label">Who would you like to see this?</span>
            <div className="mt-1 space-y-2">
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                <input type="radio" name="visibility" value="ADMINS" defaultChecked className="mt-0.5" />
                <span><span className="font-medium text-slate-800">Admins only</span><span className="block text-xs text-slate-500">Only the PURE Academy office sees it.</span></span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                <input type="radio" name="visibility" value="ADMINS_COACHES" className="mt-0.5" />
                <span><span className="font-medium text-slate-800">Admins and coaches</span><span className="block text-xs text-slate-500">Your coach can also see it{coaches.length > 0 ? " (the one selected above, if any)" : ""}.</span></span>
              </label>
            </div>
          </fieldset>

          <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
            <input type="checkbox" name="consentPublish" value="1" className="mt-0.5" />
            <span><span className="font-medium text-slate-800">OK to publish on our site?</span><span className="block text-xs text-slate-500">If checked, PURE Academy may feature this (and your first name) as a testimonial on the website. You can also leave this unchecked.</span></span>
          </label>

          <div className="flex justify-end">
            <button type="submit" className="btn-primary">Send feedback</button>
          </div>
        </form>
      )}
    </div>
  );
}
