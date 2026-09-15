import { MediaAttach } from "@/components/MediaAttach";
import type { TeamPhotoItem } from "@/lib/domain/teamPhotos";
import { formatDate } from "@/lib/time";

// A team's shared photo/video gallery — memories and action shots added by
// coaches, players, and admins. Rendered in both the console team page and the
// family portal team page. Distinct from the Training Video library, coaching
// homework, and facility photos.
export function TeamPhotos({
  teamId,
  ticket,
  returnTo,
  photos,
  canPost,
  canModerate,
  personId,
  notice,
}: {
  teamId: string;
  ticket: string;
  returnTo: string;
  photos: TeamPhotoItem[];
  canPost: boolean;
  /** Coach of this team or admin — may remove any item. */
  canModerate: boolean;
  /** The viewer's person id — may remove their own uploads. */
  personId: string | null;
  notice?: "added" | "deleted";
}) {
  return (
    <section id="team-photos" className="card scroll-mt-20">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900">Team photos</h2>
        <span className="text-xs text-slate-400">{photos.length} {photos.length === 1 ? "item" : "items"}</span>
      </div>
      <p className="mt-0.5 text-sm text-slate-500">
        Share pictures and videos from practices, matches, and team moments. Everyone on the team can add and see these.
      </p>

      {notice === "added" && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Added to the team gallery.</p>}
      {notice === "deleted" && <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">Removed from the gallery.</p>}

      {canPost && (
        <form method="POST" action="/api/team-photos" className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="add" />
          <input type="hidden" name="teamId" value={teamId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <MediaAttach label="Add a photo or video" />
          <input
            name="caption"
            maxLength={300}
            placeholder="Add a caption (optional)"
            className="input mt-2 text-sm"
          />
          {/* Public-use reminder — shown right where people upload. */}
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
            <span aria-hidden>📢</span>
            <span>Heads up: photos and videos added here may be used publicly — for example on our website, social media, or promotions. Please only add ones you&apos;re comfortable sharing.</span>
          </p>
          <div className="mt-2 flex justify-end">
            <button className="btn-primary text-sm">Add to gallery</button>
          </div>
        </form>
      )}

      {photos.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">No photos yet — be the first to add one.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => {
            const mine = !!personId && p.uploaderId === personId;
            const canRemove = canModerate || mine;
            return (
              <figure key={p.id} className="group relative overflow-hidden rounded-xl ring-1 ring-slate-200">
                <a href={p.url} target="_blank" rel="noreferrer" className="block">
                  {p.type === "VIDEO" ? (
                    <video src={p.url} controls className="h-40 w-full bg-black object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={p.caption || "Team photo"} className="h-40 w-full object-cover" />
                  )}
                </a>
                {(p.caption || p.uploaderName) && (
                  <figcaption className="px-2 py-1.5 text-xs">
                    {p.caption && <span className="block text-slate-700">{p.caption}</span>}
                    <span className="block text-slate-400">
                      {p.uploaderName ? `${p.uploaderName} · ` : ""}{formatDate(p.createdAt)}
                    </span>
                  </figcaption>
                )}
                {/* Publish controls — staff only. Choose where this item shows on
                    the public website. */}
                {canModerate && (
                  <div className="border-t border-slate-100 px-2 py-1.5">
                    <PublishToggle teamId={teamId} ticket={ticket} returnTo={returnTo} photoId={p.id} field="onWebsite" on={p.onWebsite} label="Add to website" />
                    <PublishToggle teamId={teamId} ticket={ticket} returnTo={returnTo} photoId={p.id} field="onTeamPage" on={p.onTeamPage} label="Add to team’s page" />
                  </div>
                )}
                {canRemove && (
                  <form method="POST" action="/api/team-photos" className="absolute right-1 top-1">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value="delete" />
                    <input type="hidden" name="teamId" value={teamId} />
                    <input type="hidden" name="photoId" value={p.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button
                      className="rounded-md bg-black/55 px-1.5 py-0.5 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                      title="Remove"
                      aria-label="Remove this item"
                    >
                      Remove
                    </button>
                  </form>
                )}
              </figure>
            );
          })}
        </div>
      )}
    </section>
  );
}

// A single publish checkbox (native-form toggle) below a gallery item. Clicking
// flips the flag — showing/hiding the item on the public site gallery or the
// team's public page.
export function PublishToggle({
  teamId,
  ticket,
  returnTo,
  photoId,
  field,
  on,
  label,
}: {
  teamId: string;
  ticket: string;
  returnTo: string;
  photoId: string;
  field: "onWebsite" | "onTeamPage";
  on: boolean;
  label: string;
}) {
  return (
    <form method="POST" action="/api/team-photos" className="block">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="setPublish" />
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="photoId" value={photoId} />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={on ? "0" : "1"} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        aria-pressed={on}
        className="flex w-full items-center gap-1.5 py-0.5 text-left text-xs text-slate-600 hover:text-brand-700"
      >
        <span
          aria-hidden
          className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border text-[9px] font-bold ${
            on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-transparent"
          }`}
        >
          ✓
        </span>
        {label}
      </button>
    </form>
  );
}
