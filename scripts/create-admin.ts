// One-time admin bootstrap for a fresh, empty database (e.g. production). Since
// a new DB has zero users, nobody can log into /console to seed the season —
// this creates (or upgrades) a single ADMIN account so you can. Idempotent:
// re-running with the same email just resets that account's role + password.
//
// Reads from the environment:
//   ADMIN_EMAIL      (required)
//   ADMIN_PASSWORD   (required, ≥ 8 chars — supply via a GitHub secret)
//   ADMIN_FIRST      (optional, default "Admin")
//   ADMIN_LAST       (optional, default "User")
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const firstName = (process.env.ADMIN_FIRST ?? "Admin").trim() || "Admin";
  const lastName = (process.env.ADMIN_LAST ?? "User").trim() || "User";

  if (!email || !/.+@.+\..+/.test(email)) throw new Error("ADMIN_EMAIL is missing or invalid.");
  if (password.length < 8) throw new Error("ADMIN_PASSWORD is missing or under 8 characters (set the ADMIN_BOOTSTRAP_PASSWORD secret).");

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      // Reset the brute-force lockout too, so a fresh bootstrap always yields a
      // usable, unlocked account with a known password.
      data: { role: "ADMIN", extraRoles: [], active: true, passwordHash, failedLoginCount: 0, lockedUntil: null },
    });
    console.log(`Updated existing user ${email} → ADMIN (password reset, lockout cleared).`);
  } else {
    const person =
      (await prisma.person.findFirst({ where: { email } })) ??
      (await prisma.person.create({ data: { firstName, lastName, email } }));
    await prisma.user.create({ data: { email, passwordHash, role: "ADMIN", personId: person.id, active: true } });
    console.log(`Created ADMIN ${email} (${firstName} ${lastName}).`);
  }

  console.log(`Total users in this database now: ${await prisma.user.count()}`);
  console.log("Done. Log in at /login with this email and password, then change the password in the console.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
