import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { listWebsiteGallery } from "@/lib/domain/teamPhotos";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Photo Gallery — PURE Academy" },
  description: "Moments from PURE Academy teams — practices, matches, and team memories.",
  alternates: { canonical: "/gallery" },
};

export default async function GalleryPage() {
  const items = await listWebsiteGallery();

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="display text-3xl text-brand-900 sm:text-4xl">Photo gallery</h1>
        <p className="mt-2 text-slate-600">Moments from around PURE Academy — practices, matches, and team memories.</p>

        {items.length === 0 ? (
          <p className="mt-10 text-slate-500">Photos are on the way — check back soon.</p>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((p) => (
              <figure key={p.id} className="overflow-hidden rounded-xl ring-1 ring-slate-200">
                <a href={p.url} target="_blank" rel="noreferrer" className="block">
                  {p.type === "VIDEO" ? (
                    <video src={p.url} controls className="h-44 w-full bg-black object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={p.caption || `${p.teamName} photo`} className="h-44 w-full object-cover" />
                  )}
                </a>
                <figcaption className="px-2 py-1.5 text-xs">
                  {p.caption && <span className="block text-slate-700">{p.caption}</span>}
                  {p.teamSlug ? (
                    <Link href={`/teams/${p.teamSlug}`} className="block text-brand-700 hover:underline">{p.teamName}</Link>
                  ) : (
                    <span className="block text-slate-400">{p.teamName}</span>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
