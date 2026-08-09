"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";

// First-run bootstrap: create the initial COO account when the system has no
// users yet. Locks itself the moment any user exists. Optionally gated by a
// SETUP_TOKEN env var for extra safety on a public deploy.
export async function createFirstAdmin(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string }> {
  const userCount = await prisma.user.count();
  if (userCount > 0) return { error: "Setup is already complete. Please sign in." };

  const setupToken = process.env.SETUP_TOKEN;
  if (setupToken && String(formData.get("token") ?? "") !== setupToken) {
    return { error: "Invalid setup token." };
  }

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");

  if (!firstName || !lastName || !email || !password) return { error: "All fields are required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const person = await prisma.person.create({ data: { firstName, lastName, email } });
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), role: "COO", personId: person.id },
  });

  await createSession({
    userId: user.id,
    email: user.email,
    role: "COO",
    personId: person.id,
    name: `${firstName} ${lastName}`,
  });
  redirect("/console");
}
