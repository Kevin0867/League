// Team identity (build-list §6). The display name is ALWAYS rendered from the
// stored parts — club, market, divisionCode, color — never a concatenated
// stored string, so a change to any part propagates everywhere at once.
//
//   PURE {Market} {Division} [Color]     e.g. "PURE Scottsdale W3.0", "PURE Mesa M4.5 Blue"
//   {Club} {Division} [Color]            outside clubs (market optional)

export const PURE_MARKETS = ["Scottsdale", "Mesa", "Gilbert", "Chandler", "Tempe", "Phoenix", "Paradise Valley"] as const;

/// Deterministic team-color palette. A color is only used where a market fields
/// two or more teams in a division; assigned in this fixed order.
export const TEAM_COLOR_PALETTE = ["Blue", "Green", "Red", "Yellow", "Orange", "Purple"] as const;

export type TeamParts = {
  club?: string | null;
  market?: string | null;
  divisionCode?: string | null;
  color?: string | null;
};

/// The display name, rendered from the parts. Uppercase option for apparel /
/// scoreboards / brackets where the whole name is set uppercase.
export function teamDisplayName(t: TeamParts, opts?: { uppercase?: boolean }): string {
  const parts = [t.club || "PURE", t.market, t.divisionCode, t.color].filter(Boolean) as string[];
  const name = parts.join(" ");
  return opts?.uppercase ? name.toUpperCase() : name;
}

/// A short label without the club prefix — for contexts where the club is
/// already obvious (e.g. inside a PURE-only list): "Scottsdale W3.0 Blue".
export function teamShortName(t: TeamParts): string {
  return [t.market, t.divisionCode, t.color].filter(Boolean).join(" ") || (t.club ?? "Team");
}

/// URL slug: pure-{market}-{division}[-{color}], lowercased, dots stripped.
export function teamSlug(t: TeamParts): string {
  const clubSlug = (t.club || "PURE").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const parts = [
    clubSlug,
    t.market ? t.market.toLowerCase().replace(/[^a-z0-9]+/g, "") : null,
    t.divisionCode ? t.divisionCode.toLowerCase().replace(/[^a-z0-9+]+/g, "") : null,
    t.color ? t.color.toLowerCase() : null,
  ].filter(Boolean);
  return parts.join("-");
}

/// Normalize a division code from a division name and an optional gender hint.
/// Youth → ELE/MID/HS (High School ELITE collapses to HS). Adults → M/W + band.
export function deriveDivisionCode(source: string | null | undefined, extra?: string | null): string | null {
  const s = `${source ?? ""} ${extra ?? ""}`.toLowerCase();
  if (!s.trim()) return null;
  if (/elementary|\bele\b/.test(s)) return "ELE";
  if (/middle/.test(s)) return "MID";
  if (/high school|\bhs\b/.test(s)) return "HS"; // "High School ELITE" → HS

  // Adult DUPR band. Gender from Men's/Women's; band from the first rating token.
  const gender = /women|girls|\bw\b/.test(s) ? "W" : /men|boys|\bm\b/.test(s) ? "M" : null;
  const bandMatch = s.match(/(\d\.\d)\s*\+?/);
  let band = bandMatch ? bandMatch[1] : null;
  if (band && /5\.0\s*\+|\+/.test(s) && band === "5.0") band = "5.0+";
  if (gender && band) return `${gender}${band}`;
  if (band) return band; // fall back to a bare band if gender is unknown
  return null;
}

/// The next unused palette color for a group, or null if the palette is full.
export function nextColor(used: (string | null | undefined)[]): string | null {
  const taken = new Set(used.filter(Boolean).map((c) => (c as string).toLowerCase()));
  return TEAM_COLOR_PALETTE.find((c) => !taken.has(c.toLowerCase())) ?? null;
}
