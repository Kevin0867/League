import "server-only";
import { prisma } from "@/lib/db";
import { ADMIN_ROLES } from "@/lib/enums";
import { sendEmail } from "@/lib/notify";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { formatCents } from "@/lib/money";
import { appUrl } from "@/lib/stripe";
import { audit } from "@/lib/audit";

// Alert every admin when a fee payment is unsuccessful (a failed installment or
// a declined one-time charge). Email is best-effort; the failure is always
// recorded on the Payments console (FAILED status) as the durable signal, so an
// admin sees it even when email delivery is simulated/unavailable.

export async function notifyAdminsPaymentFailed(
  paymentId: string,
  opts?: { installmentLabel?: string; failedAmountCents?: number }
): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { party: true, season: true },
  });
  if (!payment) return;

  const who = payment.party ? `${payment.party.firstName} ${payment.party.lastName}` : "A payer";
  const seasonName = payment.season?.name ?? "PURE Academy";
  const amount = formatCents(
    opts?.failedAmountCents ??
      (payment.installmentPlan
        ? Math.round(payment.amountCents / (payment.installmentsTotal ?? 3))
        : payment.amountCents)
  );
  const which = opts?.installmentLabel ? ` (${opts.installmentLabel})` : "";

  await audit({
    entityType: "Payment",
    entityId: payment.id,
    action: "PAYMENT_FAILED_ALERT",
    summary: `Payment failed for ${who}: ${amount}${which}`,
  });

  const admins = await prisma.user.findMany({
    where: { active: true, role: { in: ADMIN_ROLES as unknown as string[] }, person: { is: { email: { not: null } } } },
    select: { person: { select: { firstName: true, email: true } } },
  });

  const link = `${appUrl()}/console/payments`;
  const subject = `⚠️ Payment failed — ${who}`;
  const contentHtml =
    `<p style="margin:0 0 12px;font-size:14px;color:#b91c1c"><strong>${who}</strong>'s payment of <strong>${amount}</strong>${which} for ${seasonName} was unsuccessful.</p>` +
    `<p style="margin:0 0 14px;font-size:13px;color:#475569">Their card may have been declined or expired. Review it and follow up so the balance is collected.</p>` +
    emailButton(link, "Open Payments", { primary: true });
  const text = [
    `${who}'s payment of ${amount}${which} for ${seasonName} was unsuccessful.`,
    ``,
    `Review it in the console: ${link}`,
  ].join("\n");
  const html = brandedEmailHtml({ heading: "A payment failed", contentHtml });

  for (const a of admins) {
    const email = a.person?.email;
    if (email) await sendEmail(email, subject, text, html);
  }
}
