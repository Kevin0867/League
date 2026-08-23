import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";

// Tenant (organization) resolution for the shared multi-tenant deployment.
//
// Every request is mapped to exactly one organization by hostname, then all
// branding, contact identity, and (later) data scoping derive from it. PURE is
// the primary org and the fallback: if a host doesn't match any org — or the
// DB hasn't been migrated yet — we resolve to the primary org, and if even that
// is missing we fall back to a hardcoded PURE identity so the app never breaks.

export type Org = {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  isPrimary: boolean;
  status: string;
  // Branding (fallbacks applied — these are always safe to render).
  logoUrl: string;
  secondaryLogoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  // Contact identity (fallbacks applied).
  fromName: string;
  fromEmail: string;
  supportEmail: string;
  supportPhone: string | null;
  smsBrand: string;
  timezone: string;
  currency: string;
  stripeAccountId: string | null;
  platformFeeBps: number | null;
  settings: Record<string, unknown> | null;
};

// The platform's built-in identity — PURE. Used verbatim as the last-resort
// fallback and as the source of defaults for any field an org leaves unset, so
// existing behavior is byte-for-byte unchanged until an org overrides a value.
export const PURE_FALLBACK: Org = {
  id: "org_pure_primary",
  slug: "pure",
  name: "PURE Academy",
  legalName: "PURE Pickleball & Padel",
  isPrimary: true,
  status: "ACTIVE",
  logoUrl: "/brand/pure-academy-navy.png",
  secondaryLogoUrl: "/brand/pure-pickleball-padel.png",
  faviconUrl: null,
  primaryColor: "#2c4670",
  accentColor: "#a9d329",
  fromName: "PURE Academy",
  fromEmail: "team@purepickleball.com",
  supportEmail: "team@purepickleball.com",
  supportPhone: null,
  smsBrand: "PURE Academy",
  timezone: "America/Phoenix",
  currency: "usd",
  stripeAccountId: null,
  platformFeeBps: null,
  settings: null,
};

type OrgRow = {
  id: string; slug: string; name: string; legalName: string | null; isPrimary: boolean; status: string;
  logoUrl: string | null; secondaryLogoUrl: string | null; faviconUrl: string | null;
  primaryColor: string | null; accentColor: string | null;
  fromName: string | null; fromEmail: string | null; supportEmail: string | null; supportPhone: string | null;
  smsBrand: string | null; timezone: string | null; currency: string | null;
  stripeAccountId: string | null; platformFeeBps: number | null; settings: unknown;
};

/** Apply PURE defaults to any field the org left unset, producing a safe-to-render Org. */
function normalize(row: OrgRow): Org {
  const f = PURE_FALLBACK;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name || f.name,
    legalName: row.legalName,
    isPrimary: row.isPrimary,
    status: row.status,
    logoUrl: row.logoUrl || f.logoUrl,
    secondaryLogoUrl: row.secondaryLogoUrl,
    faviconUrl: row.faviconUrl,
    primaryColor: row.primaryColor || f.primaryColor,
    accentColor: row.accentColor || f.accentColor,
    fromName: row.fromName || row.name || f.fromName,
    fromEmail: row.fromEmail || f.fromEmail,
    supportEmail: row.supportEmail || row.fromEmail || f.supportEmail,
    supportPhone: row.supportPhone,
    smsBrand: row.smsBrand || row.name || f.smsBrand,
    timezone: row.timezone || f.timezone,
    currency: row.currency || f.currency,
    stripeAccountId: row.stripeAccountId,
    platformFeeBps: row.platformFeeBps,
    settings: (row.settings as Record<string, unknown> | null) ?? null,
  };
}

/** Bare hostname without port, lowercased. */
function hostname(raw: string | null | undefined): string {
  return (raw ?? "").split(":")[0].trim().toLowerCase();
}

/**
 * Resolve an organization from a hostname. Order: exact primaryHost match →
 * altHosts contains → first label as slug (subdomain) → primary org → PURE.
 * Never throws — any DB error resolves to the PURE fallback so a broken tenant
 * lookup can't take the whole site down.
 */
export async function resolveOrgByHost(rawHost: string | null | undefined): Promise<Org> {
  const host = hostname(rawHost);
  try {
    if (host) {
      const byHost = await prisma.organization.findFirst({
        where: { OR: [{ primaryHost: host }, { altHosts: { array_contains: host } }] },
      });
      if (byHost) return normalize(byHost as OrgRow);

      const label = host.split(".")[0];
      if (label && label !== "www") {
        const bySlug = await prisma.organization.findUnique({ where: { slug: label } });
        if (bySlug) return normalize(bySlug as OrgRow);
      }
    }
    const primary = await prisma.organization.findFirst({ where: { isPrimary: true } });
    if (primary) return normalize(primary as OrgRow);
  } catch {
    // fall through to the hardcoded PURE identity
  }
  return PURE_FALLBACK;
}

/**
 * The organization for the current request, resolved from the incoming Host
 * header and memoized for the request via React cache(). Safe to call from any
 * server component, layout, or route handler.
 */
export const currentOrg = cache(async (): Promise<Org> => {
  let host: string | null = null;
  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host");
  } catch {
    host = null;
  }
  return resolveOrgByHost(host);
});

/** The primary org (the "main site"), independent of the current request host. */
export const primaryOrg = cache(async (): Promise<Org> => {
  try {
    const primary = await prisma.organization.findFirst({ where: { isPrimary: true } });
    if (primary) return normalize(primary as OrgRow);
  } catch {
    // ignore
  }
  return PURE_FALLBACK;
});
