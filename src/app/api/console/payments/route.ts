import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dollarsToCents, formatCents } from "@/lib/money";
import { sendCustomPaymentEmail } from "@/lib/payments/customPaymentEmail";
import {
  computeStatement,
  coachSessionPayCents,
  type FacilityRates,
  type DeliveredSession,
} from "@/lib/domain/finance";

// Payments mutations as native-form-POST route handlers with ticket auth. Route
// handlers 303-redirect to a fresh GET (which carries the session cookie), so
// unlike a server action they don't re-render inline under the cookieless POST
// and bounce through the console layout's auth. See /api/console/facilities.
export const dynamic = "force-dynamic";

function monthRange(year: number, month: number) {
  // month is 1-12
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return { start, end };
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();
  const rawReturn = String(formData.get("returnTo") ?? "");
  const returnBase = rawReturn.startsWith("/console") ? rawReturn : "/console/payments";
  const back = (qs: string) => NextResponse.redirect(new URL(`${returnBase}${qs}`, origin), 303);

  const actor = await actorFromForm(formData);
  // All operations preserve the original requireFinance() gate: runPayouts.
  if (!actor || !can(actor.role, "runPayouts")) return back("?err=auth");

  const op = String(formData.get("op") ?? "");

  if (op === "statements") {
    await generateFacilityStatements(formData, actor);
    return back("?ok=statements");
  }

  if (op === "payouts") {
    await generatePayoutRun(formData, actor);
    return back("?ok=payouts");
  }

  if (op === "customRequest") {
    return customPaymentRequest(formData, actor, back);
  }

  return back("?err=op");
}

/**
 * Admin-created custom payment request: any amount, an optional percentage
 * discount, sent to a recipient as a Stripe pay link. Used for ACP entries
 * ($195, $125, …) and any other one-off charge. Card data never touches us.
 */
async function customPaymentRequest(
  formData: FormData,
  actor: { userId: string; role: string },
  back: (qs: string) => NextResponse
) {
  const g = (k: string) => String(formData.get(k) ?? "").trim();
  const name = g("name");
  const email = g("email").toLowerCase();
  const description = g("description") || "PURE Academy payment";
  const amount = parseFloat(g("amount"));
  const discountPct = Math.max(0, Math.min(100, parseInt(g("discountPercent") || "0", 10) || 0));
  const category = g("category") === "ACP_ENTRY" ? "ACP_ENTRY" : "CUSTOM";

  if (!name) return back("?err=cpname");
  if (!email || !/.+@.+\..+/.test(email)) return back("?err=cpemail");
  if (!Number.isFinite(amount) || amount <= 0) return back("?err=cpamount");

  const baseCents = dollarsToCents(amount);
  const finalCents = Math.round((baseCents * (100 - discountPct)) / 100);
  if (finalCents < 50) return back("?err=cpamount"); // Stripe minimum
  const discountNote = discountPct > 0 ? `${discountPct}% off ${formatCents(baseCents)}` : null;
  const fullDescription = discountNote ? `${description} (${discountNote})` : description;

  // Link to an existing person by email, or create a lightweight contact so the
  // charge shows a party in the ledger.
  const [firstName, ...rest] = name.split(/\s+/);
  const lastName = rest.join(" ") || "—";
  const party =
    (await prisma.person.findFirst({ where: { email } })) ??
    (await prisma.person.create({ data: { firstName, lastName, email } }));

  const payment = await prisma.payment.create({
    data: {
      direction: "IN",
      partyId: party.id,
      amountCents: finalCents,
      method: "STRIPE",
      status: "REQUESTED",
      category,
      description: fullDescription,
    },
  });

  const sendRes = await sendCustomPaymentEmail({
    toEmail: email,
    name: firstName,
    amountCents: finalCents,
    description,
    paymentId: payment.id,
    discountNote,
  });

  await audit({
    actorId: actor.userId,
    entityType: "Payment",
    entityId: payment.id,
    action: "payment.customRequest",
    summary: `Requested ${formatCents(finalCents)} from ${email}${discountNote ? ` (${discountNote})` : ""}${sendRes.ok && !sendRes.simulated ? " — emailed" : " — email not delivered"}`,
  });

  const qs = new URLSearchParams({ ok: "requested", pid: payment.id });
  if (!(sendRes.ok && !sendRes.simulated)) qs.set("cpunsent", "1");
  return back(`?${qs.toString()}`);
}

/**
 * Generate one monthly statement per facility (§10) — delivered sessions only,
 * fee by basis, on-site practice revenue for percentage sites. Cancelled
 * sessions are excluded automatically because only DELIVERED sessions are read.
 */
async function generateFacilityStatements(
  formData: FormData,
  actor: { userId: string; role: string }
) {
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

  await audit({ actorId: actor.userId, entityType: "FacilityStatement", entityId: `${year}-${month}`, action: "GENERATE", summary: `Generated ${created} facility statement(s)` });
}

/**
 * Generate a coach payout run for a period (§9): sessions delivered × flat rate
 * (assistant 50%), plus à la carte earnings, per coach.
 */
async function generatePayoutRun(
  formData: FormData,
  actor: { userId: string; role: string }
) {
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

  await audit({ actorId: actor.userId, entityType: "PayoutRun", entityId: run.id, action: "GENERATE", summary: `Payout run with ${lines} coach line(s)` });
}
