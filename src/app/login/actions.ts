"use server";

import { redirect } from "next/navigation";
import { authenticate, createSession } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";

export async function loginAction(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const session = await authenticate(email, password);
  if (!session) return { error: "Invalid email or password." };

  await createSession(session);
  redirect(isStaff(session.role) ? "/console" : "/portal");
}
