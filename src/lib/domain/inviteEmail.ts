import "server-only";
import { sendEmail } from "@/lib/notify";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { SUPPORT_ADDRESS } from "@/lib/payments/receipt";

const ROLE_WORD: Record<string, string> = {
  ADMIN: "Admin",
  COACH: "Coach",
  PLAYER: "Player",
  PARENT: "Parent",
  // Legacy admin roles, consolidated into Admin.
  COO: "Admin",
  CEO: "Admin",
  DIRECTOR: "Admin",
};

/** Emails a new console user a branded link to set their password and sign in. */
export async function sendConsoleInvite(opts: {
  toEmail: string;
  name: string;
  role: string;
  link: string;
}) {
  const roleWord = ROLE_WORD[opts.role] ?? opts.role;
  const contentHtml =
    `<p style="margin:0 0 14px;font-size:14px;color:#475569">You've been invited to the PURE Academy Console as <strong>${roleWord}</strong>. ` +
    `Set your password to activate your account.</p>` +
    emailButton(opts.link, "Set up my access", { primary: true }) +
    `<p style="margin:12px 0 0;font-size:12px;color:#94a3b8">This link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>`;

  const text = [
    `Hi ${opts.name},`,
    ``,
    `You've been invited to the PURE Academy Console as ${roleWord}.`,
    `Set your password to activate your account:`,
    opts.link,
    ``,
    `This link expires in 7 days.`,
    `Questions? Contact us at ${SUPPORT_ADDRESS}.`,
  ].join("\n");

  return sendEmail(
    opts.toEmail,
    "You're invited to the PURE Academy Console",
    text,
    brandedEmailHtml({
      heading: "You're invited",
      intro: `Welcome aboard, ${opts.name}!`,
      contentHtml,
    })
  );
}
