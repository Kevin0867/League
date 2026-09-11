import Link from "next/link";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { formatDate } from "@/lib/time";
import { TRAINING_CATEGORIES, TRAINING_SKILL_LEVELS } from "@/lib/domain/training";
import { TrainingVideoUpload } from "@/components/TrainingVideoUpload";
import { CopyUrlButton } from "@/components/CopyUrlButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Training Videos" };

export default async function TrainingLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireStaff();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const q = (sp.q ?? "").trim();
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

      {sp.ok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{sp.ok === "added" ? "Video added." : sp.ok === "deleted" ? "Video deleted." : sp.ok === "shared" ? "Shared with players." : sp.ok === "unshared" ? "No longer shared with players." : "Saved."}</div>}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
