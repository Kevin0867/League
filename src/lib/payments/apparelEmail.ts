import "server-only";
import { appUrl } from "@/lib/stripe";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { sendEmail } from "@/lib/notify";

// An apparel-only order request — no fixed amount (the family picks their items
// and sees the total at checkout), so the CTA leads to the apparel picker on the
// public /pay page. Returns {subject, text, html, sms} so it can be sent directly
// or routed through dispatchMessage with consistent logging.
export function apparelRequestEmailContent(opts: {
  name: string;
  paymentId: string;
}): { subject: string; text: string; html: string; sms: string } {
  const base = appUrl();
  const orderUrl = `${base}/pay/${opts.paymentId}`;
  const sms = `PURE Academy: order your team apparel (T-shirts & tanks) here — ${orderUrl}`;

  const contentHtml =
    `<p style="margin:0 0 14px;font-size:14px;color:#475569">Pick your team T-shirts and tank tops — choose styles, sizes, and quantities, then check out securely. You'll see your total before you pay.</p>` +
    emailButton(orderUrl, "Order team apparel", { primary: true }) +
    `<p style="margin:14px 0 0;font-size:12px;color:#94a3b8">Secure checkout is hosted by Stripe — we never see your card details. No account or login required.</p>`;

  const text = [
    `Hi ${opts.name},`,
    ``,
    `Order your PURE Academy team apparel (T-shirts & tank tops) here:`,
    orderUrl,
    ``,
    `Pick your styles, sizes, and quantities — you'll see your total before you pay.`,
    ``,
    `— PURE Academy / Arizona Club Pickleball`,
  ].join("\n");

  return {
    subject: "Order your PURE Academy team apparel",
    text,
    sms,
    html: brandedEmailHtml({ heading: "Order team apparel", intro: `Hi ${opts.name},`, contentHtml }),
  };
}

export async function sendApparelRequestEmail(opts: { toEmail: string; name: string; paymentId: string }) {
  const c = apparelRequestEmailContent(opts);
  return sendEmail(opts.toEmail, c.subject, c.text, c.html);
}
