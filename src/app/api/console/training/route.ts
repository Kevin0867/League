import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";
import { audit } from "@/lib/audit";

// Training-video library mutations (native-form POST + ticket auth). Admins and
// coaches can add, edit, share/unshare, and delete library videos. The video
// file itself is uploaded client-direct to Vercel Blob first; this route only
// stores the metadata + the resulting URL.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const rawReturn = String(fd.get("returnTo") ?? "");
  const base = rawReturn.startsWith("/console/training") ? rawReturn.split("?")[0] : "/console/training";
  const back = (qs: string) => NextResponse.redirect(new URL(`${base}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor || !isStaff(actor.role)) return back("?err=auth");

  const op = String(fd.get("op") ?? "");
  const g = (k: string) => String(fd.get(k) ?? "").trim();

  if (op === "create") {
    const title = g("title");
    const videoUrl = g("videoUrl");
    if (!title || !/^https?:\/\//.test(videoUrl)) return back("?err=fields");
    const rec = await prisma.trainingVideo.create({
      data: {
        title,
        description: g("description") || null,
        category: g("category") || null,
        skillLevel: g("skillLevel") || null,
        videoUrl,
        videoType: g("videoType") === "IMAGE" ? "IMAGE" : "VIDEO",
        visibleToPlayers: fd.get("visibleToPlayers") != null,
        uploadedById: actor.userId,
      },
    });
    await audit({ actorId: actor.userId, entityType: "TrainingVideo", entityId: rec.id, action: "CREATE", summary: `Added training video "${title}"` });
    return back("?ok=added");
  }

  if (op === "update") {
    const id = g("id");
    if (!id) return back("?err=fields");
    await prisma.trainingVideo.update({
      where: { id },
      data: {
        title: g("title") || undefined,
        description: g("description") || null,
        category: g("category") || null,
        skillLevel: g("skillLevel") || null,
      },
    }).catch(() => {});
    return back("?ok=saved");
  }

  if (op === "toggleVisible") {
    const id = g("id");
    const visible = fd.get("visibleToPlayers") != null;
    if (!id) return back("?err=fields");
    await prisma.trainingVideo.update({ where: { id }, data: { visibleToPlayers: visible } }).catch(() => {});
    await audit({ actorId: actor.userId, entityType: "TrainingVideo", entityId: id, action: "SHARE", summary: visible ? "Shared training video with players" : "Unshared training video" });
    return back(`?ok=${visible ? "shared" : "unshared"}#v-${id}`);
  }

  if (op === "delete") {
    const id = g("id");
    if (!id) return back("?err=fields");
    await prisma.trainingVideo.delete({ where: { id } }).catch(() => {});
    await audit({ actorId: actor.userId, entityType: "TrainingVideo", entityId: id, action: "DELETE", summary: "Deleted training video" });
    return back("?ok=deleted");
  }

  return back("?err=op");
}
