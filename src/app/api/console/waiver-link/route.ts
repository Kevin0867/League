import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";
import { signWaiverToken } from "@/lib/domain/waiverRenewal";

// Staff-initiated in-person waiver signing: a coach or admin picks a player and
// this mints a fresh waiver token and opens the public sign page, so the player
// (or a minor's guardian) can read and sign right there on the staff phone.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor || !isStaff(actor.roles)) return NextResponse.redirect(new URL("/console", origin), 303);

  const personId = String(fd.get("personId") ?? "").trim();
  if (!personId) return NextResponse.redirect(new URL("/console/sign-waiver?err=fields", origin), 303);

  // A minor's waiver is signed by the paying adult (guardian) — resolve up to
  // them so the sign page opens for the right signer, matching placement links.
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { guardianId: true } });
  if (!person) return NextResponse.redirect(new URL("/console/sign-waiver?err=notfound", origin), 303);
  const payerId = person.guardianId ?? personId;

  const token = await signWaiverToken(payerId);
  return NextResponse.redirect(new URL(`/waiver/sign?token=${encodeURIComponent(token)}`, origin), 303);
}
