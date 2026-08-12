// Public display + privacy rules for players (Community Layer §3.5), with the
// house override: EVERY player — youth and adult — is shown as first name and
// last initial only. Never a full surname on any public page. DUPR is published
// for adults only. Team photos require media consent from every player shown.
//
// Pure module (no imports) so it's usable anywhere, server or client.

export type PublicPersonName = { firstName: string; lastName: string | null };

/** "Kevin B." — first name + last initial, for all players regardless of age. */
export function publicPlayerName(p: PublicPersonName): string {
  const li = (p.lastName ?? "").trim().charAt(0).toUpperCase();
  return li ? `${p.firstName} ${li}.` : p.firstName;
}

/**
 * A privacy-safe, readable, stable slug for /players/[slug]. Contains the first
 * name and last INITIAL only (never the full surname), plus the opaque person id
 * as the final segment so it round-trips. cuid ids are [a-z0-9] with no dashes,
 * so the id is always the last dash-separated segment.
 */
export function publicPlayerSlug(p: PublicPersonName, id: string): string {
  const fn = p.firstName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "player";
  const li = (p.lastName ?? "").trim().charAt(0).toLowerCase() || "x";
  return `${fn}-${li}-${id}`;
}

/** Recover the person id from a player slug (the trailing segment). */
export function personIdFromPlayerSlug(slug: string): string {
  return slug.split("-").pop() ?? "";
}

/** DUPR is published for adults only; youth ratings exist but are never shown. */
export function showDupr(p: { isMinor: boolean }): boolean {
  return !p.isMinor;
}

/** A player has media consent when their waiver is signed and they haven't opted out. */
export function hasMediaConsent(p: { waiverSignedAt: Date | null; mediaOptOut: boolean }): boolean {
  return !!p.waiverSignedAt && !p.mediaOptOut;
}

/**
 * A team photo may be published only when EVERY identifiable player in it has
 * media consent. Where any player is missing consent, the photo is withheld —
 * we never crop a player out to publish it (§3.5).
 */
export function teamPhotoPublishable(players: Array<{ waiverSignedAt: Date | null; mediaOptOut: boolean }>): boolean {
  return players.length > 0 && players.every(hasMediaConsent);
}
