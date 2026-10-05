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

export type LessonPackage = { count: number; discountPct: number };
export function parsePackages(v: unknown): LessonPackage[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => { const o = x as { count?: unknown; discountPct?: unknown }; return { count: Number(o.count), discountPct: Number(o.discountPct) }; })
    .filter((p) => Number.isFinite(p.count) && p.count >= 2 && Number.isFinite(p.discountPct) && p.discountPct >= 0 && p.discountPct <= 90)
    .sort((a, b) => a.count - b.count);
}

const clampPct = (p: number | null | undefined) => Math.min(90, Math.max(0, p ?? 0));

/**
 * The GROUP base price for one lesson (before any recurring/package discount):
 *  - with price tiers → per-person(tier) × headcount;
 *  - otherwise → player 1 at the flat price, each additional player at the
 *    optional sibling/family discount.
 */
export function lessonGroupBaseCents(opts: {
  flatPerPersonCents: number;
  tiers?: PriceTier[] | null;
  additionalPersonDiscountPct?: number | null;
  headcount: number;
}): number {
  const headcount = Math.max(1, opts.headcount);
  if (opts.tiers && opts.tiers.length) return perPersonCentsFor(opts.tiers, opts.flatPerPersonCents, headcount) * headcount;
  const extra = headcount - 1;
  const extraEach = Math.round(opts.flatPerPersonCents * (1 - clampPct(opts.additionalPersonDiscountPct) / 100));
  return opts.flatPerPersonCents + extra * extraEach;
}

/** Apply a whole-series discount (recurring % or a package %) to a lesson. */
export function lessonPerLessonCents(baseCents: number, discountPct: number): number {
  return Math.round(baseCents * (1 - clampPct(discountPct) / 100));
}
