import "server-only";
import { prisma } from "@/lib/db";

// Registered players who can't get into the portal yet — nobody in their
// household has an active login. A minor is "covered" by an active guardian
// login; an adult/player needs their own. Used to see and fix the whole set.

export type NoAccessPlayer = {
  personId: string;
  name: string;
  isMinor: boolean;
  hasEmail: boolean; // can we create a login / send by email (self or guardian)?
  contact: string;
  reason: "no-login" | "disabled";
};

const ACTIVE_REG = ["SUBMITTED", "ASSIGNED", "WAITLISTED"] as const;

export async function playersWithoutPortalAccess(seasonId: string): Promise<NoAccessPlayer[]> {
  const regs = await prisma.registration.findMany({
    where: { seasonId, status: { in: [...ACTIVE_REG] } },
    select: {
      person: {
        select: {
          id: true, firstName: true, lastName: true, isMinor: true, email: true, email2: true, email3: true, phone: true,
          user: { select: { active: true } },
          guardian: { select: { email: true, email2: true, email3: true, phone: true, user: { select: { active: true } } } },
        },
      },
    },
  });

  const seen = new Set<string>();
  const out: NoAccessPlayer[] = [];
  for (const r of regs) {
    const p = r.person;
    if (seen.has(p.id)) continue;
    seen.add(p.id);

    const ownActive = p.user?.active === true;
    const guardianActive = p.guardian?.user?.active === true;
    if (ownActive || guardianActive) continue; // has access

    const ownDisabled = !!p.user && p.user.active === false;
    const guardianDisabled = !!p.guardian?.user && p.guardian.user.active === false;
    const reason: NoAccessPlayer["reason"] = ownDisabled || guardianDisabled ? "disabled" : "no-login";

    const ownEmails = [p.email, p.email2, p.email3].map((e) => (e ?? "").trim()).filter(Boolean);
    const gEmails = [p.guardian?.email, p.guardian?.email2, p.guardian?.email3].map((e) => (e ?? "").trim()).filter(Boolean);
    const hasEmail = ownEmails.length > 0 || gEmails.length > 0;
    const phone = p.phone || p.guardian?.phone || null;
    const contact = [phone, ownEmails[0] || gEmails[0] || null].filter(Boolean).join(" · ") || "no contact on file";

    out.push({ personId: p.id, name: `${p.firstName} ${p.lastName}`.trim(), isMinor: p.isMinor, hasEmail, contact, reason });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
