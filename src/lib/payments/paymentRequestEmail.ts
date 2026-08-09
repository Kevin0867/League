import "server-only";
import { appUrl } from "@/lib/stripe";
import { formatCents } from "@/lib/money";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { INSTALLMENT_COUNT, splitInstallments, SUPPORT_EMAIL } from "@/lib/payments/receipt";

// Branded fee-request email with two CTAs — pay in full, or 3 equal payments —
// each deep-linking to the focused /portal/pay page with the plan preselected.

export function paymentRequestEmail(opts: {
  name: string;
  amountCents: number;
  description: string;
  paymentId: string;
}): { subject: string; text: string; html: string } {
  const base = appUrl();
  const full = formatCents(opts.amountCents);
  const per = formatCents(splitInstallments(opts.amountCents)[1]); // even monthly amount
  const payFull = `${base}/portal/pay/${opts.paymentId}?plan=full`;
  const payInstall = `${base}/portal/pay/${opts.paymentId}?plan=installments`;

  const contentHtml =
    `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px">` +
    `<div style="display:flex;justify-content:space-between"><span style="color:#0f172a;font-weight:600">${opts.description}</span></div>` +
    `<div style="font-size:26px;font-weight:700;color:#0f172a;margin-top:4px">${full}</div>` +
    `</div>` +
    emailButton(payFull, `Pay in full — ${full}`, { primary: true }) +
    emailButton(payInstall, `Pay in 3 payments`, {
      sub: `${per} per month × ${INSTALLMENT_COUNT} — nothing charged today`,
    }) +
    `<p style="margin:14px 0 0;font-size:12px;color:#94a3b8">The fee reserves a place on a team, not a session count. ` +
    `The 3-payment plan bills automatically at the end of each of your first three training months. ` +
    `Secure checkout is hosted by Stripe — we never see your card details.</p>`;

  const text = [
    `Hi ${opts.name},`,
    ``,
    `Your ${full} season fee (${opts.description}) is ready.`,
    ``,
    `Pay in full: ${payFull}`,
    `Pay in 3 payments of ${per} (nothing today): ${payInstall}`,
    ``,
    `The fee reserves a place on a team, not a session count.`,
    `Any issues, contact us at ${SUPPORT_EMAIL}.`,
  ].join("\n");

  return {
    subject: "Your season fee is ready",
    text,
    html: brandedEmailHtml({
      heading: "Your season fee is ready",
      intro: `Hi ${opts.name} — choose how you'd like to pay. You'll finish on a secure Stripe checkout page.`,
      contentHtml,
    }),
  };
}
