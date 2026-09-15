// Public-safe venue labelling. A private residence/court must NEVER appear
// publicly by its facility name (often an owner's name, e.g. "Jim Kloss's
// Courts") or its exact address — only by general area / market (§15). Use this
// anywhere a location is shown on a public, no-login page.

export type PublicVenueParts = {
  name?: string | null;
  isPrivate?: boolean | null;
  generalArea?: string | null;
  market?: string | null;
};

/**
 * The location label safe to show publicly. For a private venue this is the
 * general area (e.g. "North Scottsdale") or the market (e.g. "Scottsdale") —
 * never the venue name or address. For a public/commercial venue the real name
 * is fine. `fallbackMarket` (e.g. the team's market) is used when the facility
 * itself carries no area/market.
 */
export function publicVenueLabel(
  facility: PublicVenueParts | null | undefined,
  fallbackMarket?: string | null,
): string | null {
  if (!facility) return fallbackMarket ?? null;
  if (facility.isPrivate) {
    return facility.generalArea || facility.market || fallbackMarket || null;
  }
  return facility.name || facility.generalArea || facility.market || fallbackMarket || null;
}
