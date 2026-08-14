import "server-only";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/stripe";
import { formatCents } from "@/lib/money";
import { sendEmail } from "@/lib/notify";
import { coveredIds } from "@/lib/payments/familyFee";
import { garmentLabel as apparelGarmentLabel, sizeLabel as apparelSizeLabel } from "@/lib/domain/apparel";

// Shared payment-confirmation content for the thank-you page and the emailed
// receipt, so the two never drift. Support contact and the second logo are
// configurable; set SUPPORT_EMAIL in the environment to override the default.

export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "team@purepickleball.com";
export const SUPPORT_PHONE = process.env.SUPPORT_PHONE || "";

// SUPPORT_EMAIL may be configured as a bare address or as a display-name form
// like `PURE Academy <team@purepickleball.com>`. A display name inside a
// `mailto:` makes mail clients show a reversed "Last First" recipient (e.g.
// "Academy PURE"), and the `<addr>` also gets swallowed as an HTML tag in the
// visible text. So always extract the bare address for both the href and label.
export function emailAddressOf(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim();
}
export const SUPPORT_ADDRESS = emailAddressOf(SUPPORT_EMAIL);
export const ACADEMY_LOGO = "/brand/pure-academy-navy.png";
export const PADEL_LOGO = "/brand/pure-pickleball-padel.png";

export const INSTALLMENT_COUNT = 3;
export const INSTALLMENT_INTERVAL_DAYS = 30;

/**
 * The three installment charge dates, anchored at REGISTRATION: the 1st charges
 * that day, the 2nd 30 days later, the 3rd 60 days later.
 */
export function installmentChargeDates(registeredAt: Date): Date[] {
  return Array.from({ length: INSTALLMENT_COUNT }, (_, i) => {
    const d = new Date(registeredAt);
    d.setDate(d.getDate() + i * INSTALLMENT_INTERVAL_DAYS);
    return d;
  });
}

/** Split a total into N equal installments; the first absorbs any remainder. */
export function splitInstallments(totalCents: number, n = INSTALLMENT_COUNT): number[] {
  const base = Math.floor(totalCents / n);
  const parts = Array(n).fill(base);
  parts[0] += totalCents - base * n;
  return parts;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export type ReceiptItem = { division: string; program: string };
export type Receipt = {
  name: string;
  email: string | null;
  items: ReceiptItem[];
  seasonName: string;
  amountCents: number;
  plan: "UPFRONT" | "INSTALLMENTS_3";
  paidNow: boolean;
  installments: { amountCents: number; date: string }[];
  apparel: { label: string; qty: number; amountCents: number }[];
  apparelTotalCents: number;
  supportEmail: string;
  supportPhone: string;
};

/** Load the confirmation summary for a payment (person, what they signed up for, totals). */
export async function loadReceipt(paymentId: string): Promise<Receipt | null> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { party: true, season: true },
  });
  if (!payment) return null;

  // A consolidated family invoice covers several players; list every enrollment
  // it pays for. Legacy single-player payments cover just their partyId.
  const covered = coveredIds(payment);
  const registrations = covered.length
    ? await prisma.registration.findMany({
        where: {
          personId: { in: covered },
          ...(payment.seasonId ? { seasonId: payment.seasonId } : {}),
        },
        include: { division: true, season: true, person: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const multi = new Set(registrations.map((r) => r.personId)).size > 1;
  const items: ReceiptItem[] = registrations.map((r) => ({
    division: multi ? `${r.person.firstName} — ${r.division?.name ?? "Academy"}` : (r.division?.name ?? "Academy"),
    program: r.season?.program === "ACP" ? "Arizona Club Pickleball" : "PURE Academy",
  }));

  // Team apparel bought with this payment (empty for non-fee payments).
  const apparelRows = await prisma.apparelOrderItem.findMany({ where: { paymentId: payment.id }, orderBy: { createdAt: "asc" } });
  const apparel = apparelRows.map((a) => ({
    label: `${a.quantity} × ${apparelGarmentLabel(a.garment)} — ${apparelSizeLabel(a.size)}`,
    qty: a.quantity,
    amountCents: a.unitPriceCents * a.quantity,
  }));
  const apparelTotalCents = apparel.reduce((s, a) => s + a.amountCents, 0);

  const plan = payment.installmentPlan ? "INSTALLMENTS_3" : "UPFRONT";
  // Installments are anchored at registration (the payment record's creation),
  // charging on that day, +30 days, and +60 days.
  const registeredAt = payment.createdAt ?? new Date();
  const installments =
    plan === "INSTALLMENTS_3"
      ? splitInstallments(payment.amountCents).map((amountCents, i) => ({
          amountCents,
          date: fmtDate(installmentChargeDates(registeredAt)[i]),
        }))
      : [];

  return {
    name: payment.party ? `${payment.party.firstName} ${payment.party.lastName}` : "there",
    email: payment.party?.email ?? null,
    items,
    seasonName: payment.season?.name ?? "PURE Academy",
    amountCents: payment.amountCents,
    plan,
    paidNow: plan === "UPFRONT",
    installments,
    apparel,
    apparelTotalCents,
    supportEmail: SUPPORT_ADDRESS,
    supportPhone: SUPPORT_PHONE,
  };
}

/** Branded HTML email body for the payment/enrollment confirmation. */
export function receiptEmailHtml(r: Receipt): string {
  const base = appUrl();
  const rows = r.items
    .map(
      (it) =>
        `<tr><td style="padding:6px 0;color:#0f172a;font-weight:600">${it.division}</td>` +
        `<td style="padding:6px 0;color:#64748b;text-align:right">${it.program}</td></tr>`
    )
    .join("");

  const money =
    r.plan === "UPFRONT"
      ? `<p style="margin:0;font-size:15px;color:#0f172a"><strong>Paid in full: ${formatCents(
          r.amountCents
        )}</strong></p>`
      : `<p style="margin:0 0 6px;font-size:15px;color:#0f172a"><strong>Total: ${formatCents(
          r.amountCents
        )}</strong> — 3 payments (today, then 30 and 60 days later)</p>` +
        `<table style="width:100%;border-collapse:collapse;font-size:14px">${r.installments
          .map(
            (p, i) =>
              `<tr><td style="padding:3px 0;color:#64748b">Payment ${i + 1} — ${p.date}${i === 0 ? " (today)" : ""}</td>` +
              `<td style="padding:3px 0;color:#0f172a;text-align:right">${formatCents(p.amountCents)}</td></tr>`
          )
          .join("")}</table>` +
        `<p style="margin:8px 0 0;font-size:12px;color:#94a3b8">The first payment is charged today; the next two are charged automatically to your card on the dates above.</p>`;

  const phone = r.supportPhone ? ` or ${r.supportPhone}` : "";

  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <table style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
    <tr><td style="padding:16px 22px;background:#ffffff;border-bottom:1px solid #e2e8f0">
      <table style="width:100%"><tr>
        <td style="text-align:left"><img src="${base}${ACADEMY_LOGO}" alt="PURE Academy" height="38" style="height:38px;border-radius:6px"></td>
        <td style="text-align:right"><img src="${base}${PADEL_LOGO}" alt="PURE Pickleball & Padel" height="42" style="height:42px"></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:26px 22px 8px">
      <h1 style="margin:0 0 6px;font-size:22px;color:#0f172a">You're enrolled, ${r.name}!</h1>
      <p style="margin:0;color:#475569;font-size:15px">Here's a summary of your ${r.seasonName} registration.</p>
    </td></tr>
    <tr><td style="padding:8px 22px">
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px">
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>
    </td></tr>
    ${r.apparel.length
      ? `<tr><td style="padding:0 22px 8px">
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px">
        <p style="margin:0 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8">Team apparel</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">${r.apparel
          .map((a) => `<tr><td style="padding:3px 0;color:#0f172a">${a.label}</td><td style="padding:3px 0;color:#64748b;text-align:right">${formatCents(a.amountCents)}</td></tr>`)
          .join("")}</table>
      </div>
    </td></tr>`
      : ""}
    <tr><td style="padding:14px 22px">${money}</td></tr>
    ${r.apparel.length
      ? `<tr><td style="padding:0 22px 8px"><p style="margin:0;font-size:13px;color:#475569">Team apparel (${formatCents(r.apparelTotalCents)}) is charged with today&rsquo;s payment. <strong>Grand total: ${formatCents(r.amountCents + r.apparelTotalCents)}</strong>.</p></td></tr>`
      : ""}
    <tr><td style="padding:8px 22px 26px">
      <p style="margin:0;color:#64748b;font-size:13px">Any issues, please contact us at
        <a href="mailto:${r.supportEmail}" style="color:#4338ca">${r.supportEmail}</a>${phone}.</p>
    </td></tr>
  </table></body></html>`;
}

export function receiptEmailSubject(r: Receipt): string {
  return r.plan === "UPFRONT"
    ? `Payment received — ${r.seasonName}`
    : `You're enrolled — ${r.seasonName} (3-payment plan)`;
}

/** Plain-text fallback for email clients that don't render HTML. */
export function receiptEmailText(r: Receipt): string {
  const lines = [
    `You're enrolled, ${r.name}!`,
    ``,
    `${r.seasonName}`,
    ...r.items.map((it) => `  - ${it.division} (${it.program})`),
    ``,
    ...(r.apparel.length ? ["Team apparel:", ...r.apparel.map((a) => `  - ${a.label} — ${formatCents(a.amountCents)}`), ""] : []),
    r.plan === "UPFRONT"
      ? `Paid in full: ${formatCents(r.amountCents)}`
      : `Total: ${formatCents(r.amountCents)} in 3 payments — the first today, then 30 and 60 days later (charged automatically):\n` +
        r.installments.map((p, i) => `  ${i + 1}. ${p.date}${i === 0 ? " (today)" : ""} — ${formatCents(p.amountCents)}`).join("\n"),
    ``,
    `Any issues, please contact us at ${r.supportEmail}${r.supportPhone ? ` or ${r.supportPhone}` : ""}.`,
  ];
  return lines.join("\n");
}

/** Send the branded confirmation email for a payment. Safe to call more than
 * once; callers should guard on their own idempotency where it matters. */
export async function sendPaymentConfirmation(paymentId: string) {
  const receipt = await loadReceipt(paymentId);
  if (!receipt?.email) return { ok: false, simulated: false, error: "no receipt/email" };
  return sendEmail(
    receipt.email,
    receiptEmailSubject(receipt),
    receiptEmailText(receipt),
    receiptEmailHtml(receipt)
  );
}
