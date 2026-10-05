import "server-only";
import { prisma } from "@/lib/db";
import { guessImportCategory } from "@/lib/payments/reconcile";

// Cross-reference ACP signups against ACTIVE Academy players. Academy players are
// automatically in ACP through their Academy/league registration, so any ACP
// signup whose email matches an active Academy player is "already in" and should
// NOT have been charged. Matching is by email (the shared key across the Replit
// ACP signups, the in-app club entries, and the Academy roster).

export type AcpPerson = {
  key: string;            // normalized email (or name when no email)
  name: string | null;
  email: string | null;
  sources: string[];      // "club entry", "charge", …
  chargedCents: number;   // total ACP money seen for this person (from charges)
  academy: { personId: string; name: string } | null; // the matched Academy player
};

export type AcpCrossReference = {
  academyCount: number;       // active Academy players on file
  people: AcpPerson[];        // every distinct ACP signup person
  alreadyIn: number;          // how many ACP signups matched an Academy player
  alreadyInChargedCents: number; // ACP money collected from already-in players
};

function parseEmailFromDesc(desc: string | null): string | null {
  const m = desc ? /·\s*([^\s·]+@[^\s·]+)\s*$/.exec(desc) : null;
  return m ? m[1].toLowerCase() : null;
}

export async function buildAcpCrossReference(): Promise<AcpCrossReference> {
  // 1) Active Academy players → every email they use, mapped to the person.
  const academySeasons = await prisma.season.findMany({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } });
  const seasonIds = academySeasons.map((s) => s.id);
  const regs = seasonIds.length
    ? await prisma.registration.findMany({
        where: { seasonId: { in: seasonIds } },
        select: { person: { select: { id: true, firstName: true, lastName: true, email: true, email2: true, email3: true } } },
      })
    : [];
  const academyByEmail = new Map<string, { personId: string; name: string }>();
  const academyIds = new Set<string>();
  for (const r of regs) {
    const p = r.person;
    if (!p) continue;
    academyIds.add(p.id);
    const nm = `${p.firstName} ${p.lastName}`.trim();
    for (const e of [p.email, p.email2, p.email3]) {
      const key = (e ?? "").toLowerCase().trim();
      if (key) academyByEmail.set(key, { personId: p.id, name: nm });
    }
  }

  // 2) ACP signups — club entries (contact + roster) and ACP charges.
  const people = new Map<string, AcpPerson>();
  const add = (name: string | null, email: string | null, source: string, chargedCents = 0) => {
    const key = (email ?? "").toLowerCase().trim() || (name ?? "").toLowerCase().trim();
    if (!key) return;
    const ex = people.get(key);
    if (ex) {
      if (!ex.sources.includes(source)) ex.sources.push(source);
      ex.chargedCents += chargedCents;
      if (!ex.name && name) ex.name = name;
      if (!ex.email && email) ex.email = email.toLowerCase();
    } else {
      people.set(key, { key, name: name ?? null, email: email ? email.toLowerCase() : null, sources: [source], chargedCents, academy: null });
    }
  };

  const entries = await prisma.acpEntry.findMany({
    where: { status: { not: "WITHDRAWN" } },
    select: { contactName: true, contactEmail: true, players: { select: { name: true, email: true } } },
    take: 500,
  });
  for (const e of entries) {
    add(e.contactName, e.contactEmail, "club entry contact");
    for (const pl of e.players) add(pl.name, pl.email, "club entry roster");
  }

  // ACP charges: filed ACP_ENTRY payments + Stripe imports that read as ACP.
  const payments = await prisma.payment.findMany({
    where: { direction: "IN", status: { in: ["PAID", "PENDING", "REQUESTED"] }, category: { in: ["ACP_ENTRY", "STRIPE_IMPORT"] } },
    select: { amountCents: true, category: true, description: true, coveredPersonIds: true, party: { select: { firstName: true, lastName: true, email: true } } },
    take: 1000,
  });
  // Resolve any "applied to" players (coveredPersonIds) so a charge is credited to
  // the player it's FOR — e.g. Chelsi pays, applies it to Clayton — not the payer.
  const coveredIds = new Set<string>();
  for (const p of payments) if (Array.isArray(p.coveredPersonIds)) for (const id of p.coveredPersonIds) if (typeof id === "string") coveredIds.add(id);
  const coveredPeople = coveredIds.size
    ? await prisma.person.findMany({ where: { id: { in: [...coveredIds] } }, select: { id: true, firstName: true, lastName: true, email: true } })
    : [];
  const coveredById = new Map(coveredPeople.map((p) => [p.id, { name: `${p.firstName} ${p.lastName}`.trim(), email: p.email }]));
  for (const p of payments) {
    const isAcp = p.category === "ACP_ENTRY" || guessImportCategory(p.description) === "ACP_ENTRY";
    if (!isAcp) continue;
    const covered = (Array.isArray(p.coveredPersonIds) ? (p.coveredPersonIds as string[]) : [])
      .map((id) => coveredById.get(id)).filter((c): c is { name: string; email: string | null } => !!c);
    if (covered.length) {
      // Credit the player(s) the charge is applied to; split evenly if more than one.
      const each = Math.round(p.amountCents / covered.length);
      for (const c of covered) add(c.name, c.email, "charge", each);
    } else {
      const email = p.party?.email ?? parseEmailFromDesc(p.description);
      const name = p.party ? `${p.party.firstName} ${p.party.lastName}`.trim() : null;
      add(name, email, "charge", p.amountCents);
    }
  }

  // 3) Flag the overlaps.
  let alreadyIn = 0, alreadyInChargedCents = 0;
  for (const person of people.values()) {
    const match = person.email ? academyByEmail.get(person.email) : null;
    if (match) {
      person.academy = match;
      alreadyIn++;
      alreadyInChargedCents += person.chargedCents;
    }
  }

  const sorted = [...people.values()].sort((a, b) => {
    if (!!a.academy !== !!b.academy) return a.academy ? -1 : 1; // already-in first
    return (b.chargedCents - a.chargedCents) || (a.name ?? "").localeCompare(b.name ?? "");
  });

  return { academyCount: academyIds.size, people: sorted, alreadyIn, alreadyInChargedCents };
}
