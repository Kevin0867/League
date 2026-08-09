import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createResetToken } from "@/lib/passwordReset";
import { sendEmail } from "@/lib/notify";

// Request a password reset. Always redirects to the same "if it exists, we sent
// it" state — never reveals whether an account exists. Emails a reset link
// (simulated/logged when RESEND_API_KEY isn't configured).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const form = await req.formData();
  const email = String(form.get("email") ?? "").toLowerCase().trim();

  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.active) {
      const raw = await createResetToken(user.id);
      const base = process.env.NEXT_PUBLIC_APP_URL || origin;
      const link = `${base}/reset?token=${raw}`;
      await sendEmail(
        user.email,
        "Reset your PURE Academy password",
        `A password reset was requested for your PURE Academy account.\n\n` +
          `Reset your password (this link expires in 1 hour):\n${link}\n\n` +
          `If you didn't request this, you can safely ignore this email.`
      );
    }
  }

  return NextResponse.redirect(new URL("/forgot?sent=1", origin), 303);
}
