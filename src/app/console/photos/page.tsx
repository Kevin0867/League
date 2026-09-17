import Link from "next/link";
import { requireAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { listAllTeamPhotos, markPhotosReviewed } from "@/lib/domain/teamPhotos";
import { PublishToggle } from "@/components/TeamPhotos";
import { RefreshOnRead } from "@/components/RefreshOnRead";
import { formatStamp } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team Photos" };

// Admin review queue for everything players and coaches add to team galleries.
// Admins see every upload in one place and choose what goes public — to the
// site gallery and/or the team's public page.
export default async function ConsolePhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ tp?: string; filter?: string }>;
}) {
  const session = await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const all = await listAllTeamPhotos();
  // Opening this page clears the "new uploads" nav badge; refresh the layout
  // once if there was anything new so the badge disappears immediately.
  const hadNew = await markPhotosReviewed(session.userId).catch(() => false);

  const filter = sp.filter === "website" ? "website" : sp.filter === "unpublished" ? "unpublished" : "all";
  const items = all.filter((p) =>
    filter === "website" ? p.onWebsite : filter === "unpublished" ? !p.onWebsite && !p.onTeamPage : true,
  );
  const returnTo = `/console/photos${filter !== "all" ? `?filter=${filter}` : ""}`;

  const Tab = ({ k, label }: { k: string; label: string }) => (
    <Link
      href={`/console/photos${k === "all" ? "" : `?filter=${k}`}`}
      className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium ${filter === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <RefreshOnRead active={hadNew} />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Team photos</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Everything players and coaches add to their team galleries. Tick a photo to publish it to the public site gallery and/or that team&apos;s public page.
        </p>
      </div>

      {sp.tp === "added" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Added.</p>}
      {sp.tp === "deleted" && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">Removed.</p>}

      <div className="flex flex-wrap gap-2">
        <Tab k="all" label={`All (${all.length})`} />
        <Tab k="unpublished" label="Not yet public" />
        <Tab k="website" label="On website" />
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-400">No photos {filter === "all" ? "yet" : "match this filter"}.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => (
            <figure key={p.id} className="group overflow-hidden rounded-xl ring-1 ring-slate-200">
              <a href={p.url} target="_blank" rel="noreferrer" className="block">
                {p.type === "VIDEO" ? (
                  <video src={p.url} controls className="h-40 w-full bg-black object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={p.caption || "Team photo"} className="h-40 w-full object-cover" />
                )}
              </a>
              <figcaption className="px-2 py-1.5 text-xs">
                <Link href={`/console/teams/${p.teamId}#team-photos`} className="block font-medium text-brand-700 hover:underline">{p.teamName}</Link>
                {p.caption && <span className="block text-slate-700">{p.caption}</span>}
                <span className="block text-slate-400">{p.uploaderName ? `${p.uploaderName} · ` : ""}{formatStamp(p.createdAt)}</span>
              </figcaption>
              <div className="border-t border-slate-100 px-2 py-1.5">
                <PublishToggle teamId={p.teamId} ticket={ticket} returnTo={returnTo} photoId={p.id} field="onWebsite" on={p.onWebsite} label="Add to website" />
                <PublishToggle teamId={p.teamId} ticket={ticket} returnTo={returnTo} photoId={p.id} field="onTeamPage" on={p.onTeamPage} label="Add to team’s page" />
                <form method="POST" action="/api/team-photos" className="mt-1">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="delete" />
                  <input type="hidden" name="teamId" value={p.teamId} />
                  <input type="hidden" name="photoId" value={p.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button className="btn-chip-danger">Remove</button>
                </form>
              </div>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
