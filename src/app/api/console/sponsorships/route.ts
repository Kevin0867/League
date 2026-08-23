import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { currentOrg } from "@/lib/org";

// Sponsorship management — benefit catalog, sponsors, packages, and secured
// deals — at the league / tournament / team levels. Native-form POST with
// signed-ticket auth, matching the rest of the console. Admin ops (catalog,
// packages) require manageTeams; a coach may source/record a sponsor for a
// team they coach.
export const dynamic = "force-dynamic";

const SCOPES = ["LEAGUE", "TOURNAMENT", "TEAM", "ORG"];
const STATUSES = ["PROSPECT", "COMMITTED", "ACTIVE", "DECLINED", "ARCHIVED"];

const dollarsToCents = (s: string) => {
  const n = Math.round(parseFloat(String(s).replace(/[^0-9.]/g, "")) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const rawReturn = String(fd.get("returnTo") ?? "");
  const returnBase = rawReturn.startsWith("/console/") ? rawReturn : "/console/sponsorships";
  const back = (qs: string) => NextResponse.redirect(new URL(`${returnBase}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return back("?err=auth");
  const op = String(fd.get("op") ?? "");
  const g = (k: string) => String(fd.get(k) ?? "").trim();
  const orgId = (await currentOrg()).id;
  const isAdmin = can(actor.role, "manageTeams");

  // Resolve this actor's coach id (for team-level authorization).
  const coachId = async () => {
    const u = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
    if (!u?.personId) return null;
    const c = await prisma.coach.findUnique({ where: { personId: u.personId }, select: { id: true } });
    return c?.id ?? null;
  };
  const coachOwnsTeam = async (teamId: string) => {
    const cid = await coachId();
    if (!cid) return false;
    const t = await prisma.team.findUnique({ where: { id: teamId }, select: { coachId: true, assistantCoaches: { select: { coachId: true } } } });
    return !!t && (t.coachId === cid || t.assistantCoaches.some((a) => a.coachId === cid));
  };

  switch (op) {
    // ---- Benefit catalog (admin) ----------------------------------------
    case "benefitCreate": {
      if (!isAdmin) return back("?err=perm");
      const label = g("label");
      if (!label) return back("?err=fields");
      const max = await prisma.sponsorBenefit.aggregate({ where: { organizationId: orgId }, _max: { sortOrder: true } });
      await prisma.sponsorBenefit.create({ data: { organizationId: orgId, label, description: g("description") || null, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
      return back("?ok=benefit#benefits");
    }
    case "benefitUpdate": {
      if (!isAdmin) return back("?err=perm");
      const id = g("id");
      const label = g("label");
      if (!id || !label) return back("?err=fields");
      await prisma.sponsorBenefit.update({ where: { id }, data: { label, description: g("description") || null } });
      return back("?ok=benefit#benefits");
    }
    case "benefitToggle": {
      if (!isAdmin) return back("?err=perm");
      const id = g("id");
      const cur = await prisma.sponsorBenefit.findUnique({ where: { id }, select: { active: true } });
      if (cur) await prisma.sponsorBenefit.update({ where: { id }, data: { active: !cur.active } });
      return back("?ok=benefit#benefits");
    }
    case "benefitDelete": {
      if (!isAdmin) return back("?err=perm");
      await prisma.sponsorBenefit.delete({ where: { id: g("id") } }).catch(() => {});
      return back("?ok=benefitDel#benefits");
    }

    // ---- Sponsors --------------------------------------------------------
    case "sponsorCreate": {
      if (!isAdmin && !(await coachId())) return back("?err=perm");
      const name = g("name");
      if (!name) return back("?err=fields");
      await prisma.sponsor.create({
        data: {
          organizationId: orgId, name,
          contactName: g("contactName") || null, email: g("email") || null, phone: g("phone") || null,
          website: g("website") || null, logoUrl: g("logoUrl") || null, notes: g("notes") || null,
        },
      });
      return back("?ok=sponsor#sponsors");
    }
    case "sponsorUpdate": {
      if (!isAdmin) return back("?err=perm");
      const id = g("id");
      if (!id) return back("?err=fields");
      await prisma.sponsor.update({
        where: { id },
        data: {
          name: g("name") || undefined,
          contactName: g("contactName") || null, email: g("email") || null, phone: g("phone") || null,
          website: g("website") || null, logoUrl: g("logoUrl") || null, notes: g("notes") || null,
        },
      });
      return back("?ok=sponsor#sponsors");
    }
    case "sponsorDelete": {
      if (!isAdmin) return back("?err=perm");
      await prisma.sponsor.delete({ where: { id: g("id") } }).catch(() => {});
      return back("?ok=sponsorDel#sponsors");
    }

    // ---- Packages (admin) ------------------------------------------------
    case "packageCreate":
    case "packageUpdate": {
      if (!isAdmin) return back("?err=perm");
      const name = g("name");
      const scopeType = SCOPES.includes(g("scopeType")) ? g("scopeType") : "LEAGUE";
      const scopeId = scopeType === "ORG" ? null : (g("scopeId") || null);
      if (!name) return back("?err=fields");
      const benefitIds = fd.getAll("benefitIds").map((v) => String(v)).filter(Boolean);
      const data = {
        organizationId: orgId, name, scopeType, scopeId,
        description: g("description") || null,
        priceCents: dollarsToCents(g("price")),
        inventory: g("inventory") ? Math.max(0, parseInt(g("inventory"), 10) || 0) : null,
      };
      let pkgId: string;
      if (op === "packageCreate") {
        const created = await prisma.sponsorshipPackage.create({ data });
        pkgId = created.id;
      } else {
        pkgId = g("id");
        if (!pkgId) return back("?err=fields");
        await prisma.sponsorshipPackage.update({ where: { id: pkgId }, data });
        await prisma.sponsorshipPackageBenefit.deleteMany({ where: { packageId: pkgId } });
      }
      if (benefitIds.length) {
        await prisma.sponsorshipPackageBenefit.createMany({
          data: benefitIds.map((benefitId) => ({ packageId: pkgId, benefitId })),
          skipDuplicates: true,
        });
      }
      return back("?ok=package#packages");
    }
    case "packageDelete": {
      if (!isAdmin) return back("?err=perm");
      await prisma.sponsorshipPackage.delete({ where: { id: g("id") } }).catch(() => {});
      return back("?ok=packageDel#packages");
    }

    // ---- Sponsorship deals ----------------------------------------------
    case "sponsorshipCreate": {
      const scopeType = SCOPES.includes(g("scopeType")) ? g("scopeType") : "LEAGUE";
      const scopeId = scopeType === "ORG" ? null : (g("scopeId") || null);
      // A coach may only record a deal for a team they coach; admins anywhere.
      if (!isAdmin) {
        if (scopeType !== "TEAM" || !scopeId || !(await coachOwnsTeam(scopeId))) return back("?err=perm");
      }
      const sponsorId = g("sponsorId");
      if (!sponsorId) return back("?err=fields");
      const status = STATUSES.includes(g("status")) ? g("status") : "PROSPECT";
      await prisma.sponsorship.create({
        data: {
          organizationId: orgId, sponsorId, scopeType, scopeId,
          packageId: g("packageId") || null,
          amountCents: dollarsToCents(g("amount")),
          status, benefitsNote: g("benefitsNote") || null, notes: g("notes") || null,
          securedById: actor.userId,
        },
      });
      await audit({ actorId: actor.userId, entityType: "Sponsorship", entityId: sponsorId, action: "CREATE", summary: `Sponsorship recorded (${scopeType})` });
      return back("?ok=deal#deals");
    }
    case "sponsorshipUpdate": {
      const id = g("id");
      if (!id) return back("?err=fields");
      const existing = await prisma.sponsorship.findUnique({ where: { id }, select: { scopeType: true, scopeId: true } });
      if (!existing) return back("?err=notfound");
      if (!isAdmin) {
        if (existing.scopeType !== "TEAM" || !existing.scopeId || !(await coachOwnsTeam(existing.scopeId))) return back("?err=perm");
      }
      const status = STATUSES.includes(g("status")) ? g("status") : undefined;
      await prisma.sponsorship.update({
        where: { id },
        data: {
          ...(status ? { status } : {}),
          amountCents: g("amount") ? dollarsToCents(g("amount")) : undefined,
          benefitsNote: fd.has("benefitsNote") ? (g("benefitsNote") || null) : undefined,
          notes: fd.has("notes") ? (g("notes") || null) : undefined,
        },
      });
      return back("?ok=deal#deals");
    }
    case "sponsorshipDelete": {
      const id = g("id");
      const existing = await prisma.sponsorship.findUnique({ where: { id }, select: { scopeType: true, scopeId: true } });
      if (!existing) return back("?err=notfound");
      if (!isAdmin) {
        if (existing.scopeType !== "TEAM" || !existing.scopeId || !(await coachOwnsTeam(existing.scopeId))) return back("?err=perm");
      }
      await prisma.sponsorship.delete({ where: { id } }).catch(() => {});
      return back("?ok=dealDel#deals");
    }

    // One-step team sourcing: create the sponsor AND the team sponsorship in a
    // single action, so a coach can add a sponsor they've secured for their team
    // without a separate sponsor-then-deal flow. Admin anywhere; a coach only for
    // a team they coach.
    case "teamSponsorQuickAdd": {
      const teamId = g("teamId");
      if (!teamId) return back("?err=fields");
      if (!isAdmin && !(await coachOwnsTeam(teamId))) return back("?err=perm");
      const name = g("sponsorName");
      if (!name) return back("?err=fields");
      const status = STATUSES.includes(g("status")) ? g("status") : "COMMITTED";
      const sponsor = await prisma.sponsor.create({
        data: {
          organizationId: orgId, name,
          contactName: g("contactName") || null, email: g("email") || null,
          phone: g("phone") || null, website: g("website") || null,
        },
      });
      await prisma.sponsorship.create({
        data: {
          organizationId: orgId, sponsorId: sponsor.id, scopeType: "TEAM", scopeId: teamId,
          amountCents: dollarsToCents(g("amount")), status,
          benefitsNote: g("benefitsNote") || null, securedById: actor.userId,
        },
      });
      await audit({ actorId: actor.userId, entityType: "Sponsorship", entityId: teamId, action: "CREATE", summary: `Team sponsor added: ${name}` });
      return back("?ok=teamSponsor#sponsors");
    }

    default:
      return back("?err=op");
  }
}
