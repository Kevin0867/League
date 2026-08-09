"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import {
  computeStatement,
  coachSessionPayCents,
  type FacilityRates,
  type DeliveredSession,
} from "@/lib/domain/finance";

async function requireFinance() {
  const session = await getSession();
  if (!session || !can(session.role, "runPayouts")) {
    throw new Error("Not authorized to run payouts.");
  }
  return session;
}

function monthRange(year: number, month: number) {
  // month is 1-12
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return { start, end };
}

/**
 * Generate one monthly statement per facility (§10) — delivered sessions only,
 * fee by basis, on-site practice revenue for percentage sites. Cancelled
 * sessions are excluded automatically because only DELIVERED sessions are read.
 */
export async function generateFacilityStatements(formData: FormData) {
  const session = await requireFinance();
  const year = Number(formData.get("year") ?? new Date().getUTCFullYear());
  const month = Number(formData.get("month") ?? new Date().getUTCMonth() + 1);
  const { start, end } = monthRange(year, month);

  const facilities = await prisma.facility.findMany();
  let created = 0;

  for (const f of facilities) {
    const delivered = await prisma.session.findMany({
      where: { facilityId: f.id, status: "DELIVERED", date: { gte: start, lt: end } },
      select: { courtCount: true, startTime: true, endTime: true, date: true, teams: { select: { teamId: true } } },
    });

    // On-site practice revenue: PAID season fees for players on teams that
    // practice at this facility, net (approximation — refunds/processing netted
    // as they are recorded). Only meaningful for PERCENTAGE sites.
    let onSiteRevenueCents = 0;
    if (f.feeBasis === "PERCENTAGE") {
      const teamIds = [...new Set(delivered.flatMap((s) => s.teams.map((t) => t.teamId)))];
      if (teamIds.length) {
        const memberIds = (
          await prisma.teamMember.findMany({ where: { teamId: { in: teamIds } }, select: { personId: true } })
        ).map((m) => m.personId);
        const paid = await prisma.payment.aggregate({
          where: { partyId: { in: memberIds }, category: "PLAYER_FEE", status: "PAID" },
          _sum: { amountCents: true },
        });
        const refunds = await prisma.payment.aggregate({
          where: { partyId: { in: memberIds }, category: "REFUND", status: "PAID" },
          _sum: { amountCents: true },
        });
        onSiteRevenueCents = (paid._sum.amountCents ?? 0) - (refunds._sum.amountCents ?? 0);
      }
    }

    const rates: FacilityRates = {
      feeBasis: f.feeBasis,
      weekdayRateCents: f.weekdayRateCents,
      weekendRateCents: f.weekendRateCents,
      percentageRate: f.percentageRate,
    };
    const ds: DeliveredSession[] = delivered.map((s) => ({
      courtCount: s.courtCount, startTime: s.startTime, endTime: s.endTime, date: s.date,
    }));
    const result = computeStatement(rates, ds, onSiteRevenueCents);

    // Skip facilities with no activity and no obligation.
    if (result.sessionsDelivered === 0 && result.amountDueCents === 0) continue;

    await prisma.facilityStatement.create({
      data: {
        facilityId: f.id,
        periodStart: start,
        periodEnd: end,
        sessionsDelivered: result.sessionsDelivered,
        onSiteRevenueCents: result.onSiteRevenueCents,
        amountDueCents: result.amountDueCents,
        status: "ISSUED",
      },
    });
    created++;
  }

  await audit({ actorId: session.userId, entityType: "FacilityStatement", entityId: `${year}-${month}`, action: "GENERATE", summary: `Generated ${created} facility statement(s)` });
  revalidatePath("/console/payments");
}

/**
 * Generate a coach payout run for a period (§9): sessions delivered × flat rate
 * (assistant 50%), plus à la carte earnings, per coach.
 */
export async function generatePayoutRun(formData: FormData) {
  const session = await requireFinance();
  const year = Number(formData.get("year") ?? new Date().getUTCFullYear());
  const month = Number(formData.get("month") ?? new Date().getUTCMonth() + 1);
  const { start, end } = monthRange(year, month);

  const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
  const perSession = rate?.coachPerSessionCents ?? 10000;
  const assistantPct = rate?.assistantPct ?? 0.5;
  const proPerSession = rate?.proCoachPerSessionCents ?? null;

  const run = await prisma.payoutRun.create({
    data: { periodStart: start, periodEnd: end, status: "DRAFT" },
  });

  const coaches = await prisma.coach.findMany({ include: { person: true } });
  let lines = 0;

  for (const coach of coaches) {
    // Delivered sessions this coach worked in the period, with their role.
    const sessionCoachRows = await prisma.sessionCoach.findMany({
      where: {
        coachId: coach.id,
        session: { status: "DELIVERED", date: { gte: start, lt: end } },
      },
      select: { role: true },
    });

    let sessionPayCents = 0;
    for (const sc of sessionCoachRows) {
      sessionPayCents += coachSessionPayCents(sc.role, perSession, assistantPct, proPerSession);
    }

    // À la carte earnings (delivered) in the period.
    const ala = await prisma.alaCarteBooking.aggregate({
      where: { coachId: coach.id, status: "DELIVERED", scheduledAt: { gte: start, lt: end } },
      _sum: { coachCents: true },
    });
    const alaCarteCents = ala._sum.coachCents ?? 0;

    if (sessionCoachRows.length === 0 && alaCarteCents === 0) continue;

    await prisma.coachPayoutLine.create({
      data: {
        payoutRunId: run.id,
        coachId: coach.id,
        sessionsDelivered: sessionCoachRows.length,
        sessionPayCents,
        alaCarteCents,
        totalCents: sessionPayCents + alaCarteCents,
      },
    });
    lines++;
  }

  await audit({ actorId: session.userId, entityType: "PayoutRun", entityId: run.id, action: "GENERATE", summary: `Payout run with ${lines} coach line(s)` });
  revalidatePath("/console/payments");
}
