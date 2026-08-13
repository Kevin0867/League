import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm, hashPassword, verifyPassword } from "@/lib/auth";

// Self-service password change for any signed-in user. Console mutations run as
// POSTs (no session cookie on this runtime), so the actor is resolved from the
// console ticket embedded in the form, exactly like other console actions.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (q: string) => NextResponse.redirect(new URL(`/console/profile?${q}`, origin), 303);

  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor) return back("pwerr=auth");

  const current = String(fd.get("currentPassword") ?? "");
  const next = String(fd.get("newPassword") ?? "");
  const confirm = String(fd.get("newPasswordConfirm") ?? "");
  if (!current || !next) return back("pwerr=fields");
  if (next.length < 8) return back("pwerr=short");
  if (next !== confirm) return back("pwerr=mismatch");

  const user = await prisma.user.findUnique({ where: { id: actor.userId } });
  if (!user) return back("pwerr=auth");
  if (!(await verifyPassword(current, user.passwordHash))) return back("pwerr=current");

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next), failedLoginCount: 0, lockedUntil: null },
  });
  return back("pwok=1");
}
