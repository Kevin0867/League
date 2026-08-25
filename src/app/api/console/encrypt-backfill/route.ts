import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { isEncrypted } from "@/lib/crypto";
import { ENCRYPTED_FIELDS } from "@/lib/prisma-encryption";

// One-time (idempotent) backfill: encrypt any rows whose encrypted-list fields
// are still stored as plaintext (data written before a field was added to the
// encryption set). Reads return the raw stored value, so isEncrypted() tells us
// what still needs it; re-saving through the Prisma layer encrypts it. Safe to
// run repeatedly — already-encrypted values are skipped.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/system${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");

  const plaintextData = (row: Record<string, unknown>, fields: string[]) => {
    const data: Record<string, string> = {};
    for (const f of fields) {
      const v = row[f];
      if (typeof v === "string" && v !== "" && !isEncrypted(v)) data[f] = v;
    }
    return data;
  };

  let people = 0;
  let registrations = 0;
  try {
    const pFields = ENCRYPTED_FIELDS.person;
    const pSelect = { id: true, ...Object.fromEntries(pFields.map((f) => [f, true])) } as Prisma.PersonSelect;
    const persons = (await prisma.person.findMany({ select: pSelect })) as Array<Record<string, unknown>>;
    for (const p of persons) {
      const data = plaintextData(p, pFields);
      if (Object.keys(data).length) {
        await prisma.person.update({ where: { id: p.id as string }, data });
        people++;
      }
    }

    const rFields = ENCRYPTED_FIELDS.registration;
    const rSelect = { id: true, ...Object.fromEntries(rFields.map((f) => [f, true])) } as Prisma.RegistrationSelect;
    const regs = (await prisma.registration.findMany({ select: rSelect })) as Array<Record<string, unknown>>;
    for (const r of regs) {
      const data = plaintextData(r, rFields);
      if (Object.keys(data).length) {
        await prisma.registration.update({ where: { id: r.id as string }, data });
        registrations++;
      }
    }
  } catch (e) {
    console.error("encrypt-backfill failed", e);
    return back(`?err=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : "backfill failed")}`);
  }

  await audit({
    actorId: actor.userId,
    entityType: "System",
    entityId: "encrypt-backfill",
    action: "ENCRYPT_BACKFILL",
    summary: `Encrypted plaintext fields on ${people} people, ${registrations} registrations`,
  });
  return back(`?enc=${people}.${registrations}`);
}
