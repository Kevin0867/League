// Read-only diagnostic for Community Layer §2.1: is the standings mess in the
// CODE (already migrated) or in the DATA? Prints the active ACP league roster
// with derived display names, flags duplicate team identities, un-normalized or
// HS-ELITE division codes, and worded Division rows — so we know what to clean.
import { prisma } from "@/lib/db";
import { teamDisplayName } from "@/lib/domain/teamName";
import { leagueStandingsFlat } from "@/lib/domain/leagueStandings";

async function main() {
  const season = await prisma.season.findFirst({ where: { active: true, program: "ACP" } });
  console.log("=== Active ACP season ===");
  console.log(season ? `${season.name} (${season.id})` : "(none)");
  if (!season) return;

  const rows = await leagueStandingsFlat(season.id);
  console.log(`\n=== Standings rows (${rows.length}) ===`);
  const nameCount = new Map<string, number>();
  for (const r of rows) {
    console.log(`- ${r.teamName}  [slug ${r.teamSlug}]  P${r.played} W${r.matchesWon} L${r.matchesLost}`);
    nameCount.set(r.teamName, (nameCount.get(r.teamName) ?? 0) + 1);
  }
  const dupes = [...nameCount.entries()].filter(([, n]) => n > 1);
  console.log(`\n=== Duplicate display names in standings: ${dupes.length} ===`);
  for (const [name, n] of dupes) console.log(`- ${JSON.stringify(name)} ×${n}`);

  // All PURE teams — check identity parts for un-normalized/HS-ELITE codes.
  const teams = await prisma.team.findMany({
    select: { id: true, name: true, club: true, market: true, divisionCode: true, color: true, published: true, division: { select: { name: true } } },
    orderBy: [{ market: "asc" }, { divisionCode: "asc" }],
  });
  console.log(`\n=== All teams (${teams.length}) ===`);
  const identity = new Map<string, number>();
  for (const t of teams) {
    const key = `${t.club}|${t.market}|${t.divisionCode}|${t.color}`;
    identity.set(key, (identity.get(key) ?? 0) + 1);
    const flag = /elite/i.test(t.divisionCode ?? "") || /elite/i.test(t.division?.name ?? "") ? "  <-- ELITE?" : "";
    console.log(`- ${teamDisplayName(t)}  (code=${JSON.stringify(t.divisionCode)}, div=${JSON.stringify(t.division?.name ?? null)}, pub=${t.published})${flag}`);
  }
  const idDupes = [...identity.entries()].filter(([, n]) => n > 1);
  console.log(`\n=== Duplicate team identities (club|market|code|color): ${idDupes.length} ===`);
  for (const [k, n] of idDupes) console.log(`- ${k} ×${n}`);

  // Divisions — worded names / duplicates.
  const divisions = await prisma.division.findMany({ where: { seasonId: season.id }, select: { name: true, divisionType: true } });
  console.log(`\n=== Divisions in active season (${divisions.length}) ===`);
  for (const d of divisions) console.log(`- ${JSON.stringify(d.name)} (${d.divisionType})${/elite/i.test(d.name) ? "  <-- ELITE?" : ""}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
