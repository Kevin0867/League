// Pure lesson-pricing helpers — shared by the server (checkout math) and the
// client (live price on the booking wizard), so NOT server-only.

export type PriceTier = { people: number; perPersonCents: number };

/** Normalize stored/submitted price tiers into a clean ascending list. */
export function parsePriceTiers(v: unknown): PriceTier[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      const o = x as { people?: unknown; perPersonCents?: unknown };
      return { people: Number(o.people), perPersonCents: Number(o.perPersonCents) };
    })
    .filter((t) => Number.isFinite(t.people) && t.people > 0 && Number.isFinite(t.perPersonCents) && t.perPersonCents >= 0)
    .sort((a, b) => a.people - b.people);
}

/** Per-person price for a given headcount: exact tier if present, else the
 *  highest tier at or below the headcount, else the flat price. */
export function perPersonCentsFor(tiers: PriceTier[] | null | undefined, flatPerPersonCents: number, headcount: number): number {
  const list = tiers && tiers.length ? [...tiers].sort((a, b) => a.people - b.people) : null;
  if (!list) return flatPerPersonCents;
  const exact = list.find((t) => t.people === headcount);
  if (exact) return exact.perPersonCents;
  let chosen = list[0];
  for (const t of list) if (t.people <= headcount) chosen = t;
  return chosen.perPersonCents;
}
