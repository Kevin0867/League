import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Logo } from "@/components/Brand";

export const dynamic = "force-dynamic";
export const metadata = { title: "Training video" };

// A single training video, by a stable per-video link that can be shared with
// coaches, admins, and (when shared to players) families. Staff always see any
// video; a player/parent only if it's been shared with players.
export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/watch/${id}`)}`);

  const video = await prisma.trainingVideo.findUnique({ where: { id } });
  if (!video) redirect(isStaff(session.role) ? "/console/training" : "/portal/training");

  const staff = isStaff(session.roles ?? [session.role]);
  if (!staff && !video.visibleToPlayers) {
    // Not shared with players — send them to their library instead.
    redirect("/portal/training");
  }

  const isImage = video.videoType === "IMAGE";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Logo href={staff ? "/console/training" : "/portal/training"} />
          <Link href={staff ? "/console/training" : "/portal/training"} className="btn-link">All videos →</Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-black">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={video.videoUrl} alt={video.title} className="mx-auto max-h-[70vh] w-auto" />
          ) : (
            <video controls playsInline preload="metadata" className="aspect-video w-full bg-black">
              <source src={video.videoUrl} />
              Your browser can&apos;t play this video. <a href={video.videoUrl} className="underline">Download it</a> instead.
            </video>
          )}
        </div>

        <div className="mt-4">
          <h1 className="text-xl font-bold text-slate-900">{video.title}</h1>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            {video.category && <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">{video.category}</span>}
            {video.skillLevel && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{video.skillLevel}</span>}
          </div>
          {video.description && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{video.description}</p>}
        </div>
      </main>
    </div>
  );
}
