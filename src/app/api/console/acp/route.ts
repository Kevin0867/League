import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { deriveDivisionCode } from "@/lib/domain/teamName";

// Console actions on ACP outside-club entries: edit the record, manage its
// roster, turn an interest into an entry, and convert a submitted entry into a
// real Team (origin ACP_CLUB) that can be published and added to the league.
export const dynamic = "force-dynamic";

/** Find or create a Person by email; backfill DUPR when we learn it. */
async function upsertPerson(fullName: string, email: string | null, dupr: number | null) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || "Player";
  const lastName = parts.slice(1).join(" ") || "—";
  const e = (email ?? "").trim();
  if (e) {
    const existing = await prisma.person.findFirst({ where: { OR: [{ email: e }, { email: e.toLowerCase() }] } });
    if (existing) {
      if (dupr != null && existing.duprRating == null) {
        await prisma.person.update({ where: { id: existing.id }, data: { duprRating: dupr } });
      }
      return existing;
    }
  }
  return prisma.person.create({ data: { firstName, lastName, email: e || null, duprRating: dupr } });
}

async function activeAcpSeasonId(): Promise<string | null> {
  const s = await prisma.season.findFirst({ where: { program: "ACP", active: true }, select: { id: true } });
  return s?.id ?? null;
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  const op = String(formData.get("op") ?? "");
  const listBack = (qs: string) => NextResponse.redirect(new URL(`/console/acp${qs}`, origin), 303);
  if (!actor || !can(actor.role, "manageTeams")) return listBack("?err=auth");

  // Turn an interest sign-up into a formal entry the admin can flesh out.
  if (op === "interestToEntry") {
    const interestId = String(formData.get("interestId") ?? "");
    const interest = await prisma.acpInterest.findUnique({ where: { id: interestId } });
    if (!interest) return listBack("?err=notfound");
    const divisionName = interest.likelyDivisions || "Unspecified";
    const entry = await prisma.acpEntry.create({
      data: {
        seasonId: await activeAcpSeasonId(),
        clubName: interest.clubName,
        market: interest.market,
        divisionName,
        divisionCode: deriveDivisionCode(divisionName),
        contactName: interest.contactName,
        contactEmail: interest.email,
        contactPhone: interest.phone,
        playerCount: 0,
        amountDueCents: 0,
        status: "SUBMITTED",
        notes: "Created from interest sign-up.",
      },
    });
    await audit({ actorId: actor.userId, entityType: "AcpEntry", entityId: entry.id, action: "CREATE", summary: `Created ACP entry from interest — ${interest.clubName}` });
    return NextResponse.redirect(new URL(`/console/acp/${entry.id}?ok=created`, origin), 303);
  }

  const entryId = String(formData.get("entryId") ?? "");
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/acp/${entryId}${qs}`, origin), 303);
  const entry = await prisma.acpEntry.findUnique({ where: { id: entryId } });
  if (!entry) return listBack("?err=notfound");

  switch (op) {
    case "updateEntry": {
      const divisionName = String(formData.get("divisionName") ?? "").trim() || entry.divisionName;
      await prisma.acpEntry.update({
        where: { id: entryId },
        data: {
          clubName: String(formData.get("clubName") ?? "").trim() || entry.clubName,
          market: String(formData.get("market") ?? "").trim() || null,
          divisionName,
          divisionCode: deriveDivisionCode(divisionName) ?? entry.divisionCode,
          contactName: String(formData.get("contactName") ?? "").trim() || entry.contactName,
          contactEmail: String(formData.get("contactEmail") ?? "").trim() || entry.contactEmail,
          contactPhone: String(formData.get("contactPhone") ?? "").trim() || null,
          status: String(formData.get("status") ?? entry.status),
          notes: String(formData.get("notes") ?? "").trim() || null,
        },
      });
      await audit({ actorId: actor.userId, entityType: "AcpEntry", entityId: entryId, action: "UPDATE", summary: `Updated ACP entry ${entry.clubName}` });
      return back("?ok=saved");
    }

    case "addPlayer": {
      const name = String(formData.get("name") ?? "").trim();
      if (!name) return back("?err=name");
      const duprRaw = String(formData.get("duprRating") ?? "").trim();
      const dupr = duprRaw ? parseFloat(duprRaw) : NaN;
      await prisma.acpEntryPlayer.create({
        data: { entryId, name, email: String(formData.get("email") ?? "").trim() || null, duprRating: Number.isFinite(dupr) ? dupr : null },
      });
      await prisma.acpEntry.update({ where: { id: entryId }, data: { playerCount: { increment: 1 } } });
      return back("?ok=playeradded");
    }

    case "removePlayer": {
      const playerId = String(formData.get("playerId") ?? "");
      const del = await prisma.acpEntryPlayer.deleteMany({ where: { id: playerId, entryId } });
      if (del.count > 0) await prisma.acpEntry.update({ where: { id: entryId }, data: { playerCount: { decrement: 1 } } });
      return back("?ok=playerremoved");
    }

    // Create a real Team from this entry so it can be published + added to the
    // league. Reuses an existing ACP team for the same club+division+season to
    // avoid duplicates; creates Person + TeamMember rows for the roster.
    case "convertToTeam": {
      const seasonId = entry.seasonId ?? (await activeAcpSeasonId());
      if (!seasonId) return back("?err=noseason");
      const divisionCode = entry.divisionCode ?? deriveDivisionCode(entry.divisionName) ?? null;

      const existing = await prisma.team.findFirst({
        where: { seasonId, origin: "ACP_CLUB", clubName: entry.clubName, ...(divisionCode ? { divisionCode } : {}) },
        select: { id: true },
      });
      if (existing) return NextResponse.redirect(new URL(`/console/teams/${existing.id}?ok=exists`, origin), 303);

      const division = await prisma.division.findFirst({ where: { seasonId, name: entry.divisionName }, select: { id: true } });
      const players = await prisma.acpEntryPlayer.findMany({ where: { entryId } });
      const contact = await upsertPerson(entry.contactName, entry.contactEmail, null);

      const team = await prisma.team.create({
        data: {
          name: `${entry.clubName} — ${entry.divisionName}`,
          seasonId,
          origin: "ACP_CLUB",
          clubName: entry.clubName,
          market: entry.market ?? null,
          divisionCode,
          divisionId: division?.id ?? null,
          teamContactId: contact.id,
          published: false,
        },
      });

      for (const p of players) {
        const person = await upsertPerson(p.name, p.email, p.duprRating ?? null);
        await prisma.teamMember.upsert({
          where: { teamId_personId: { teamId: team.id, personId: person.id } },
          create: { teamId: team.id, personId: person.id, roleOnTeam: "PLAYER" },
          update: {},
        });
      }

      await prisma.acpEntry.update({ where: { id: entryId }, data: { status: "CONFIRMED" } });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: team.id, action: "CREATE", summary: `Created ACP team from entry — ${entry.clubName}` });
      return NextResponse.redirect(new URL(`/console/teams/${team.id}?ok=createTeam`, origin), 303);
    }

    case "deleteEntry": {
      await prisma.acpEntry.delete({ where: { id: entryId } });
      await audit({ actorId: actor.userId, entityType: "AcpEntry", entityId: entryId, action: "DELETE", summary: `Deleted ACP entry ${entry.clubName}` });
      return listBack("?ok=deleted");
    }
  }

  return back("?err=op");
}
