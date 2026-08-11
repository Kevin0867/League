import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { uploadImage } from "@/lib/upload";

// Profile-image upload (multipart). A coach uploads their own; an admin may
// upload for another coach by passing personId. Ticket-authenticated like the
// other console mutations.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const rawReturn = String(fd.get("returnTo") ?? "");
  const returnTo = rawReturn.startsWith("/console") ? rawReturn : "/console/profile";
  const back = (qs: string) => NextResponse.redirect(new URL(`${returnTo}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return back("?imgerr=auth");

  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
  const requested = String(fd.get("personId") ?? "");
  const editingOther = !!requested && requested !== me?.personId;
  if (editingOther && !isAdmin(actor.role)) return back("?imgerr=auth");
  const personId = editingOther ? requested : me?.personId ?? "";
  if (!personId) return back("?imgerr=auth");

  const file = fd.get("file");
  if (!(file instanceof File)) return back("?imgerr=" + encodeURIComponent("Choose an image to upload."));

  const res = await uploadImage(file, `coaches/${personId}`);
  if (!res.ok) return back("?imgerr=" + encodeURIComponent(res.error));

  await prisma.person.update({ where: { id: personId }, data: { imageUrl: res.url } });
  await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: "person.image", summary: "Uploaded profile image" });
  return back("?imgok=1");
}
