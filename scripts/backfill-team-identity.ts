/**
 * Backfill team identity into separate parts (build-list §6) and recompute the
 * display name from them. Also merges the wrong "High School ELITE" division
 * into "High School" (there is no ELITE division). Idempotent.
 *
 * Run locally:  npx tsx --tsconfig tsconfig.scripts.json scripts/backfill-team-identity.ts
 * Run on Neon:  the backfill-team-identity GitHub Actions workflow.
 */
import { PrismaClient } from "@prisma/client";
import { PURE_MARKETS, TEAM_COLOR_PALETTE, deriveDivisionCode, teamDisplayName } from "../src/lib/domain/teamName";

const prisma = new PrismaClient();

function parseMarket(name: string, existing: string | null): string | null {
  if (existing) return existing;
  const first = name.split(/[\s·]+/)[0];
  const hit = PURE_MARKETS.find((m) => m.toLowerCase() === first.toLowerCase());
  return hit ?? null;
}

async function mergeHighSchoolElite() {
  const seasons = await prisma.season.findMany({ select: { id: true } });
  for (const s of seasons) {
    const divisions = await prisma.division.findMany({ where: { seasonId: s.id } });
    const elite = divisions.filter((d) => /high school elite/i.test(d.name));
    if (!elite.length) continue;
    const target = divisions.find((d) => /^high school$/i.test(d.name.trim()));
    for (const e of elite) {
      if (target) {
        await prisma.team.updateMany({ where: { divisionId: e.id }, data: { divisionId: target.id } });
        await prisma.registration.updateMany({ where: { divisionId: e.id }, data: { divisionId: target.id } });
        await prisma.division.delete({ where: { id: e.id } });
        console.log(`Merged "${e.name}" → "High School" (season ${s.id})`);
      } else {
        await prisma.division.update({ where: { id: e.id }, data: { name: "High School" } });
        console.log(`Renamed "${e.name}" → "High School" (season ${s.id})`);
      }
    }
  }
}

async function main() {
  await mergeHighSchoolElite();

  const teams = await prisma.team.findMany({ include: { division: true } });
  for (const t of teams) {
    const club = t.origin === "PURE_ACADEMY" ? "PURE" : (t.clubName || "Club");
    const market = parseMarket(t.name, t.market);
    const divisionCode = deriveDivisionCode(t.division?.name ?? null, `${t.name} ${t.levelBand ?? ""}`);
    await prisma.team.update({
      where: { id: t.id },
      data: { club, market, divisionCode },
    });
  }

  // Assign colors: any (club, market, divisionCode) group with 2+ teams gets
  // palette colors in a deterministic order; single-team groups stay null.
  const refreshed = await prisma.team.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const groups = new Map<string, typeof refreshed>();
  for (const t of refreshed) {
    if (!t.market || !t.divisionCode) continue; // outside single-site / unknowns
    const key = `${t.club}|${t.market}|${t.divisionCode}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  for (const [key, members] of groups) {
    if (members.length < 2) {
      // Ensure a lone team carries no color.
      for (const m of members) if (m.color) await prisma.team.update({ where: { id: m.id }, data: { color: null } });
      continue;
    }
    for (let i = 0; i < members.length; i++) {
      const color = TEAM_COLOR_PALETTE[i] ?? null;
      await prisma.team.update({ where: { id: members[i].id }, data: { color } });
    }
    console.log(`Assigned ${members.length} colors to ${key}`);
  }

  // Recompute the display name from the parts so every screen shows the
  // convention immediately.
  const finalTeams = await prisma.team.findMany();
  for (const t of finalTeams) {
    const name = teamDisplayName(t);
    if (name && name !== t.name) await prisma.team.update({ where: { id: t.id }, data: { name } });
  }

  console.log(`Backfilled ${teams.length} teams.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
