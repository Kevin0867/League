import Link from "next/link";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { TRAINING_CATEGORIES, TRAINING_SKILL_LEVELS } from "@/lib/domain/training";

export const dynamic = "force-dynamic";
export const metadata = { title: "Training Videos" };

// Players/parents see only videos a coach or admin chose to share.
export default async function PortalTrainingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const category = sp.category ?? "";
  const skill = sp.skill ?? "";

  const videos = await prisma.trainingVideo.findMany({
    where: {
      visibleToPlayers: true,
      ...(category ? { category } : {}),
      ...(skill ? { skillLevel: skill } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Training Videos</h1>
        <p className="text-sm text-slate-500">Drills and technique your coaches have shared. Great for homework between sessions.</p>
      </div>

      <form method="GET" action="/portal/training" className="card flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">
          <label className="label">Search</label>
          <input type="search" name="q" defaultValue={q} placeholder="Search drills…" className="input" />
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
        {(q || category || skill) && <Link href="/portal/training" className="btn-ghost text-sm">Clear</Link>}
      </form>

      {videos.length === 0 ? (
        <div className="card text-sm text-slate-400">No training videos shared yet. Your coach will post drills here.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {videos.map((v) => (
            <div key={v.id} className="card space-y-2">
              <div className="overflow-hidden rounded-lg bg-black">
                {v.videoType === "IMAGE" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.videoUrl} alt={v.title} className="max-h-72 w-full object-contain" />
                ) : (
                  <video src={v.videoUrl} controls preload="metadata" className="max-h-72 w-full" />
                )}
              </div>
              <h3 className="font-semibold text-slate-900">{v.title}</h3>
              {v.description && <p className="whitespace-pre-line text-sm text-slate-600">{v.description}</p>}
              <div className="flex flex-wrap gap-1.5 text-xs">
                {v.category && <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700 ring-1 ring-brand-100">{v.category}</span>}
                {v.skillLevel && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{v.skillLevel}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
