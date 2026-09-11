import Link from "next/link";
import { requireStaff, isAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { formatDate } from "@/lib/time";
import { TRAINING_CATEGORIES, TRAINING_SKILL_LEVELS } from "@/lib/domain/training";
import { TrainingVideoUpload } from "@/components/TrainingVideoUpload";
import { CopyUrlButton } from "@/components/CopyUrlButton";
import { allowedContacts } from "@/lib/domain/messaging-acl";

export const dynamic = "force-dynamic";
export const metadata = { title: "Training Videos" };

export default async function TrainingLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireStaff();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const q = (sp.q ?? "").trim();

  // Teams the viewer can share a video TO: admins → every active-season team;
  // a coach → only the teams they coach.
  const admin = isAdmin(session.roles ?? [session.role]);
  const myCoach = !admin && session.personId
    ? await prisma.coach.findUnique({ where: { personId: session.personId }, select: { id: true } })
    : null;
  const teamOptions = admin
    ? await prisma.team.findMany({ where: { isTest: false, season: { active: true } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : myCoach
      ? await prisma.team.findMany({ where: { season: { active: true }, OR: [{ coachId: myCoach.id }, { assistantCoaches: { some: { coachId: myCoach.id } } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [];
  // People the viewer can message directly (their team's players/parents, staff)
  // — for sharing a video with one person.
  const contacts = session.personId ? await allowedContacts(session.personId, session.role).catch(() => []) : [];
  const category = sp.category ?? "";
  const skill = sp.skill ?? "";

  const videos = await prisma.trainingVideo.findMany({
    where: {
      ...(category ? { category } : {}),
      ...(skill ? { skillLevel: skill } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Training Videos" subtitle="A shared library of drills and technique. Share any video with players for homework, or copy its link into a team text or email." />

      {sp.ok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{sp.ok === "added" ? "Video added." : sp.ok === "deleted" ? "Video deleted." : sp.ok === "shared" ? "Shared with players." : sp.ok === "unshared" ? "No longer shared with players." : sp.ok === "teamsent" ? `Sent to the team${sp.n ? ` — ${sp.n} recipient${sp.n === "1" ? "" : "s"}` : ""}.` : "Saved."}</div>}
      {sp.err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">Something went wrong — try again.</div>}

      <TrainingVideoUpload ticket={ticket} />

      {/* Filters */}
      <form method="GET" action="/console/training" className="card flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">
          <label className="label">Search</label>
          <input type="search" name="q" defaultValue={q} placeholder="Title or description…" className="input" />
        </div>
        <div>
          <label className="label">Category</label>
          <select name="category" defaultValue={category} className="input">
            <option value="">All</option>
            {TRAINING_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Skill</label>
          <select name="skill" defaultValue={skill} className="input">
            <option value="">All</option>
            {TRAINING_SKILL_LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button className="btn-secondary text-sm">Filter</button>
        {(q || category || skill) && <Link href="/console/training" className="btn-ghost text-sm">Clear</Link>}
      </form>

      {videos.length === 0 ? (
        <div className="card text-sm text-slate-400">No videos yet. Add the first drill above.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {videos.map((v) => (
            <div key={v.id} id={`v-${v.id}`} className="card scroll-mt-24 space-y-2">
              <div className="overflow-hidden rounded-lg bg-black">
                {v.videoType === "IMAGE" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.videoUrl} alt={v.title} className="max-h-64 w-full object-contain" />
                ) : (
                  <video src={v.videoUrl} controls preload="metadata" className="max-h-64 w-full" />
                )}
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">{v.title}</h3>
                {v.description && <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{v.description}</p>}
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                  {v.category && <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700 ring-1 ring-brand-100">{v.category}</span>}
                  {v.skillLevel && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{v.skillLevel}</span>}
                  {v.visibleToPlayers && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">Shared with players</span>}
                  <span className="px-1 text-slate-400">{formatDate(v.createdAt)}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                <CopyUrlButton url={v.videoUrl} label="Copy video link" />
                <form method="POST" action="/api/console/training" className="inline">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="toggleVisible" />
                  <input type="hidden" name="id" value={v.id} />
                  <input type="hidden" name="returnTo" value="/console/training" />
                  {/* Present-only-when-sharing: absence of the field = unshare. */}
                  {!v.visibleToPlayers && <input type="hidden" name="visibleToPlayers" value="1" />}
                  <button className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
                    {v.visibleToPlayers ? "Unshare from players" : "Share with players"}
                  </button>
                </form>
                <form method="POST" action="/api/console/training" className="ml-auto inline">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="delete" />
                  <input type="hidden" name="id" value={v.id} />
                  <input type="hidden" name="returnTo" value="/console/training" />
                  <button className="text-xs text-rose-600 hover:underline">Delete</button>
                </form>
              </div>

              <details className="border-t border-slate-100 pt-2">
                <summary className="cursor-pointer text-xs font-semibold text-brand-700 hover:underline">Share (person, team, or admins) →</summary>
                <div className="mt-2 space-y-3">
                  {/* To one person on their team */}
                  {contacts.length > 0 && (
                    <form method="POST" action="/api/messages" className="space-y-1.5 rounded-lg bg-slate-50 p-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Send to a person</div>
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="start" />
                      <input type="hidden" name="returnTo" value="/console/inbox" />
                      <input type="hidden" name="attachmentUrl" value={v.videoUrl} />
                      <input type="hidden" name="attachmentType" value={v.videoType ?? "VIDEO"} />
                      <input type="hidden" name="notifyEmail" value="on" />
                      <select name="recipientId" required className="input py-1 text-sm">
                        <option value="">Choose a person…</option>
                        {contacts.map((c) => <option key={c.personId} value={c.personId}>{c.name} · {c.role === "ADMIN" ? "Admin" : c.role === "COACH" ? "Coach" : "Parent"}</option>)}
                      </select>
                      <textarea name="body" rows={1} className="input text-sm" defaultValue={v.title} placeholder="Note…" />
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-600"><input type="checkbox" name="notifySms" /> Also text</label>
                        <button className="btn-secondary text-xs">Send</button>
                      </div>
                    </form>
                  )}

                  {/* To a whole team */}
                  {teamOptions.length > 0 && (
                    <form method="POST" action="/api/console/team-notes" className="space-y-1.5 rounded-lg bg-slate-50 p-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Send to a team</div>
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="broadcastTeam" />
                      <input type="hidden" name="returnTo" value="/console/training" />
                      <input type="hidden" name="attachmentUrl" value={v.videoUrl} />
                      <input type="hidden" name="attachmentType" value={v.videoType ?? "VIDEO"} />
                      <select name="teamId" required className="input py-1 text-sm">
                        <option value="">Choose a team…</option>
                        {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <textarea name="body" rows={1} className="input text-sm" defaultValue={[v.title, v.description].filter(Boolean).join(" — ")} placeholder="Note to the team…" />
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-600"><input type="checkbox" name="channel_SMS" /> Also text the team</label>
                        <button className="btn-secondary text-xs">Send to team</button>
                      </div>
                    </form>
                  )}

                  {/* To all admins — so a coach can confirm an admin saw it */}
                  <form method="POST" action="/api/console/messages" className="rounded-lg bg-slate-50 p-2">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value="send" />
                    <input type="hidden" name="audienceType" value="ALL_ADMINS" />
                    <input type="hidden" name="returnTo" value="/console/training" />
                    <input type="hidden" name="subject" value={`Training video: ${v.title}`} />
                    <input type="hidden" name="body" value={`Shared a training video: ${v.title}${v.description ? ` — ${v.description}` : ""}`} />
                    <input type="hidden" name="attachmentUrl" value={v.videoUrl} />
                    <input type="hidden" name="attachmentType" value={v.videoType ?? "VIDEO"} />
                    <input type="hidden" name="channel_IN_APP" value="on" />
                    <input type="hidden" name="channel_EMAIL" value="on" />
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Send to admins</span>
                      <button className="btn-secondary text-xs">Notify admins</button>
                    </div>
                  </form>
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
