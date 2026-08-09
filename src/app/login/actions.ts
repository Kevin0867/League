"use server";

import { authenticate, createSession } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";

// Set the session cookie and return the destination. We deliberately do NOT
// call redirect() here: setting a cookie and throwing a redirect in the same
// server action can drop the Set-Cookie header, so the client performs a full
// navigation once the cookie is committed.
export async function loginAction(
  _prev: { error?: string; redirect?: string } | undefined,
  formData: FormData
): Promise<{ error?: string; redirect?: string }> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const session = await authenticate(email, password);
  if (!session) return { error: "Invalid email or password." };

  await createSession(session);
  return { redirect: isStaff(session.role) ? "/console" : "/portal" };
}
