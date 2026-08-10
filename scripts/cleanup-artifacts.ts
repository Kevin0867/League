import { prisma } from "../src/lib/db";

// One-off cleanup of test/dev artifacts that leaked into a live database:
//  - divisions literally named "TEST" (and their teams),
//  - LESSON-type divisions mistakenly created as league divisions (lessons are
//    AlaCarteOfferings, not divisions) and their teams,
//  - a stray "✎" that got appended to a division name.
// Teams are removed safely: rostered players return to the pool, and every
// dependent row (members, coaches, pairings, fixtures + their children,
// championship matches, session links) is cleared before the team is deleted.

async function deleteTeamsSafely(teamIds: string[]) {
  if (teamIds.length === 0) return;

  // Rostered players go back to the pool (never silently dropped).
  const members = await prisma.teamMember.findMany({ where: { teamId: { in: teamIds } }, select: { personId: true, team: { select: { seasonId: true } } } });
  for (const m of members) {
    await prisma.registration.updateMany({
      where: { personId: m.personId, seasonId: m.team.seasonId, status: "ASSIGNED" },
      data: { status: "SUBMITTED" },
    });
  }
  await prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } });
  await prisma.teamCoach.deleteMany({ where: { teamId: { in: teamIds } } });
  await prisma.pairing.deleteMany({ where: { teamId: { in: teamIds } } });

  // Fixtures referencing these teams, plus their children.
  const fixtures = await prisma.fixture.findMany({
    where: { OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }] },
    select: { id: true },
  });
  const fxIds = fixtures.map((f) => f.id);
  if (fxIds.length) {
    const lines = await prisma.lineMatchup.findMany({ where: { fixtureId: { in: fxIds } }, select: { id: true } });
    await prisma.gameScore.deleteMany({ where: { lineId: { in: lines.map((l) => l.id) } } });
    await prisma.lineMatchup.deleteMany({ where: { fixtureId: { in: fxIds } } });
    await prisma.availabilityConfirmation.deleteMany({ where: { fixtureId: { in: fxIds } } });
    await prisma.duprSubmission.deleteMany({ where: { fixtureId: { in: fxIds } } }).catch(() => {});
    await prisma.rescheduleRequest.deleteMany({ where: { fixtureId: { in: fxIds } } }).catch(() => {});
    await prisma.fixture.deleteMany({ where: { id: { in: fxIds } } });
  }

  // Championship matches referencing these teams (ids are nullable, no cascade).
  await prisma.championshipMatch.deleteMany({
    where: { OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }, { winnerTeamId: { in: teamIds } }] },
  }).catch(() => {});
  await prisma.sessionTeam.deleteMany({ where: { teamId: { in: teamIds } } }).catch(() => {});

  await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
}

async function main() {
  // 1) Divisions to purge: LESSON type, or named "TEST"/"TEST Div".
  const divs = await prisma.division.findMany({ select: { id: true, name: true, divisionType: true } });
  const purge = divs.filter((d) => d.divisionType === "LESSON" || /^\s*test(\s|$)/i.test(d.name));
  console.log(`Divisions to purge (${purge.length}):`, purge.map((d) => `"${d.name}" [${d.divisionType}]`).join(", ") || "none");

  for (const d of purge) {
    const teams = await prisma.team.findMany({ where: { divisionId: d.id }, select: { id: true, name: true } });
    console.log(`  purging "${d.name}" — ${teams.length} team(s): ${teams.map((t) => t.name).join(", ") || "none"}`);
    await deleteTeamsSafely(teams.map((t) => t.id));
    // Any remaining teams that referenced this division but weren't deleted → null out (safety).
    await prisma.team.updateMany({ where: { divisionId: d.id }, data: { divisionId: null } });
    await prisma.registration.updateMany({ where: { divisionId: d.id }, data: { divisionId: null } });
    await prisma.division.delete({ where: { id: d.id } });
  }

  // 2) Strip a stray trailing "✎" (and surrounding space) from any division name.
  const emojiDivs = (await prisma.division.findMany({ select: { id: true, name: true } })).filter((d) => /✎/.test(d.name));
  for (const d of emojiDivs) {
    const clean = d.name.replace(/\s*✎\s*/g, " ").trim();
    console.log(`  renaming "${d.name}" → "${clean}"`);
    await prisma.division.update({ where: { id: d.id }, data: { name: clean } });
  }

  console.log("Cleanup complete.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
