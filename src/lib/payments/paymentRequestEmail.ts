import "server-only";
import { appUrl } from "@/lib/stripe";
import { formatCents } from "@/lib/money";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { INSTALLMENT_COUNT, splitInstallments, SUPPORT_ADDRESS } from "@/lib/payments/receipt";

// Branded fee-request email with two CTAs — pay in full, or 3 equal payments —
// each deep-linking to the PUBLIC /pay page with the plan preselected — payable
// with no login, so parents without an account can pay straight from the email.

export function paymentRequestEmail(opts: {
  name: string;
  amountCents: number;
  description: string;
  paymentId: string;
}): { subject: string; text: string; html: string; sms: string } {
  const base = appUrl();
  const full = formatCents(opts.amountCents);
  const per = formatCents(splitInstallments(opts.amountCents)[1]); // even monthly amount
  const payFull = `${base}/pay/${opts.paymentId}?plan=full`;
  const payInstall = `${base}/pay/${opts.paymentId}?plan=installments`;

  // Pull the "<Player> · <Team>" detail out of the description so the subject and
  // text can name exactly which player/team this invoice is for — a parent with
  // two children on two teams gets two clearly distinct notifications.
  const detail = /season fee\s*[—-]\s*/i.test(opts.description)
    ? opts.description.replace(/^.*?season fee\s*[—-]\s*/i, "").trim()
    : "";
  const subject = detail ? `Season fee + team apparel — ${detail}` : "Your season fee + team apparel";
  const sms =
    `PURE Academy: ${detail ? detail + " — " : ""}${full} season fee + team apparel is ready. ` +
    `Pick apparel & pay: ${payFull}`;

  const contentHtml =
    `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px">` +
    `<div style="display:flex;justify-content:space-between"><span style="color:#0f172a;font-weight:600">${opts.description}</span></div>` +
    `<div style="font-size:26px;font-weight:700;color:#0f172a;margin-top:4px">${full} <span style="font-size:13px;font-weight:500;color:#64748b">season fee</span></div>` +
    `<div style="font-size:13px;color:#64748b;margin-top:4px">+ your team T-shirt or tank top — you'll pick style &amp; size at checkout</div>` +
    `</div>` +
    `<p style="margin:0 0 14px;font-size:14px;color:#475569">Each player picks their <strong>team apparel</strong> first, then pays the season fee and apparel together in one secure checkout.</p>` +
    emailButton(payFull, `Choose apparel &amp; pay`, { primary: true }) +
    emailButton(payInstall, `Prefer 3 payments?`, {
      sub: `Season fee as ${per}/mo × 3; apparel with the first payment`,
    }) +
    `<p style="margin:14px 0 0;font-size:12px;color:#94a3b8">The fee reserves a place on a team, not a session count. ` +
    `The 3-payment plan charges the first payment today and the next two automatically 30 and 60 days later. ` +
    `Secure checkout is hosted by Stripe — we never see your card details.</p>`;

  const text = [
    `Hi ${opts.name},`,
    ``,
    `Your ${full} season fee (${opts.description}) is ready — plus your team T-shirt or tank top.`,
    `Pick your apparel (style & size) at checkout, then pay the fee and apparel together.`,
    ``,
    `Choose apparel & pay in full: ${payFull}`,
    `Prefer 3 payments? Season fee as ${per}/mo × 3 (apparel with the first): ${payInstall}`,
    ``,
    `The fee reserves a place on a team, not a session count.`,
    `Any issues, contact us at ${SUPPORT_ADDRESS}.`,
  ].join("\n");

  return {
    subject,
    text,
    sms,
    html: brandedEmailHtml({
      heading: detail ? `Season fee + apparel — ${detail}` : "Season fee + team apparel",
      intro: `Hi ${opts.name} — pick your team apparel, then choose how you'd like to pay. You'll finish on a secure Stripe checkout page.`,
      contentHtml,
    }),
  };
}
