import type { MetadataRoute } from "next";
import { allTeamSlugs } from "@/lib/domain/teamPage";

const BASE = "https://academy.purepickleball.com";

// Public pages plus a page per published team. The app's private routes are not
// indexed (see robots.ts).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const paths = [
    "/", "/programs", "/coaches", "/clinics", "/locations",
    "/standings", "/schedule", "/championship", "/acp", "/teams",
    "/register", "/terms", "/privacy", "/season-terms", "/opt-in",
  ];
  const staticEntries = paths.map((p) => ({
    url: `${BASE}${p}`,
    changeFrequency: "weekly" as const,
    priority: p === "/" ? 1 : 0.7,
  }));

  // Team pages are derived from published teams; tolerate a DB hiccup at build
  // time by falling back to the static list.
  let teamEntries: MetadataRoute.Sitemap = [];
  try {
    const slugs = await allTeamSlugs();
    teamEntries = slugs.map((s) => ({
      url: `${BASE}/teams/${s}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));
  } catch {
    teamEntries = [];
  }

  return [...staticEntries, ...teamEntries];
}
