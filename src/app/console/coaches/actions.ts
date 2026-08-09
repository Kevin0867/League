"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { Role } from "@/lib/enums";

const CREATABLE_ROLES: Role[] = ["DIRECTOR", "CEO", "COACH"];

export async function createStaff(
  _prev: { error?: string; ok?: string } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: string }> {
  const session = await getSession();
  if (!session || !["COO", "DIRECTOR"].includes(session.role)) {
    return { error: "Not authorized to create accounts." };
  }

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const role = String(formData.get("role") ?? "COACH") as Role;
  const password = String(formData.get("password") ?? "");

  if (!firstName || !lastName || !email || !password) return { error: "All fields are required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (!CREATABLE_ROLES.includes(role)) return { error: "Invalid role." };
  // Only a COO may mint admin-level roles; a Director can create coaches.
  if (role !== "COACH" && session.role !== "COO") {
    return { error: "Only the COO can create Director or CEO accounts." };
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) return { error: "A user with that email already exists." };

  // Reuse a Person with this email (e.g. a coach who also registered) if present.
  const person =
    (await prisma.person.findFirst({ where: { email } })) ??
    (await prisma.person.create({ data: { firstName, lastName, email } }));

  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), role, personId: person.id },
  });

  await audit({
    actorId: session.userId,
    entityType: "User",
    entityId: user.id,
    action: "user.create",
    summary: `Created ${role} account for ${email}`,
  });
  revalidatePath("/console/coaches");
  return { ok: `Created ${role.toLowerCase()} account for ${firstName} ${lastName}.` };
}
