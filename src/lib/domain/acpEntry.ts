// ACP outside-club entry (build-list item 1, Phase B). Entries open Sep 14,
// close Oct 12; $195 per player; 6–8 players per team; adult divisions are
// validated against the division's DUPR band. Pure functions here so the route
// and the page share one source of truth.
import { deriveDivisionCode } from "@/lib/domain/teamName";

export const ACP_FEE_PER_PLAYER_CENTS = 19_500; // $195
export const ACP_MIN_PLAYERS = 6;
export const ACP_MAX_PLAYERS = 8;

// Phoenix is UTC-7 (no DST). Window edges are inclusive calendar days there:
// opens 12:00am Sep 14, closes end of day Oct 12.
export const ACP_ENTRIES_OPEN = new Date("2026-09-14T07:00:00Z");
export const ACP_ENTRIES_CLOSE = new Date("2026-10-13T06:59:59Z"); // end of Oct 12 Phoenix

export type EntryWindow = "before" | "open" | "closed";

/// Which phase of the entry window we're in. An override (env or arg) lets us
/// preview the open flow before Sep 14 without time-travel.
export function acpEntryWindow(now: Date = new Date()): EntryWindow {
  const override = process.env.ACP_ENTRIES_OVERRIDE;
  if (override === "before" || override === "open" || override === "closed") return override;
  if (now < ACP_ENTRIES_OPEN) return "before";
  if (now > ACP_ENTRIES_CLOSE) return "closed";
  return "open";
}

export type RosterPlayerInput = {
  name: string;
  email?: string | null;
  duprId?: string | null;
  duprRating?: number | null;
};

export type EntryValidation =
  | { ok: true; divisionCode: string | null; isAdult: boolean; bandCeiling: number | null; amountCents: number; players: RosterPlayerInput[] }
  | { ok: false; error: string };

/// The DUPR ceiling for an adult band code (e.g. "W3.5" → 3.5, "M5.0+" → null =
/// open ceiling). Youth codes have no ceiling.
export function bandCeiling(divisionCode: string | null): number | null {
  if (!divisionCode) return null;
  if (/\+/.test(divisionCode)) return null; // "5.0+" is open at the top
  const m = divisionCode.match(/(\d\.\d)/);
  return m ? parseFloat(m[1]) : null;
}

function isAdultCode(divisionCode: string | null): boolean {
  return !!divisionCode && /^[MW]\d/.test(divisionCode);
}

/// Validate a whole entry: roster size, per-division DUPR requirements, and the
/// play-up-only band rule. Returns the derived division code + fee on success.
export function validateEntry(input: {
  divisionName: string;
  players: RosterPlayerInput[];
}): EntryValidation {
  const divisionCode = deriveDivisionCode(input.divisionName);
  const adult = isAdultCode(divisionCode);
  const ceiling = bandCeiling(divisionCode);

  const players = input.players
    .map((p) => ({
      name: (p.name ?? "").trim(),
      email: (p.email ?? "")?.toString().trim().toLowerCase() || null,
      duprId: (p.duprId ?? "")?.toString().trim() || null,
      duprRating: p.duprRating != null && Number.isFinite(p.duprRating) ? p.duprRating : null,
    }))
    .filter((p) => p.name.length > 0);

  if (!input.divisionName.trim()) return { ok: false, error: "Choose the division you're entering." };
  if (players.length < ACP_MIN_PLAYERS)
    return { ok: false, error: `A team needs at least ${ACP_MIN_PLAYERS} players — you listed ${players.length}.` };
  if (players.length > ACP_MAX_PLAYERS)
    return { ok: false, error: `A team can list at most ${ACP_MAX_PLAYERS} players — you listed ${players.length}.` };

  // Adult divisions play by DUPR band: every player needs a rating, and no one
  // rated above the band ceiling (you may play up, never down).
  if (adult) {
    const missing = players.filter((p) => p.duprRating == null);
    if (missing.length > 0)
      return {
        ok: false,
        error: `Adult divisions are seeded by DUPR — enter a DUPR rating for every player (${missing.length} missing).`,
      };
    if (ceiling != null) {
      const over = players.filter((p) => (p.duprRating as number) > ceiling + 1e-9);
      if (over.length > 0)
        return {
          ok: false,
          error: `This is a ${ceiling.toFixed(1)} division — ${over
            .map((p) => `${p.name} (${(p.duprRating as number).toFixed(2)})`)
            .join(", ")} ${over.length === 1 ? "is" : "are"} rated above ${ceiling.toFixed(1)}. Players may play up, not down.`,
        };
    }
  }

  return {
    ok: true,
    divisionCode,
    isAdult: adult,
    bandCeiling: ceiling,
    amountCents: players.length * ACP_FEE_PER_PLAYER_CENTS,
    players,
  };
}
