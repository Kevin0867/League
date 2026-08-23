import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";

// Super-admin management of licensed organizations (tenants). Native-form POST
// with signed-ticket auth, like the rest of the console mutations. Only a
// platform admin may create or edit orgs; a licensed customer's own admins get
// nowhere near this (gated by can(manageOrganizations) + the page guard).
export const dynamic = "force-dynamic";

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

const host = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").split(":")[0] || null;

// Accept a hex like "#0f766e" or "0f766e"; return normalized "#rrggbb" or null.
function hex(s: string): string | null {
  const v = s.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v.toLowerCase()}` : null;
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const back = (qs: string, id?: string) =>
    NextResponse.redirect(new URL(`/console/organizations${id ? `/${id}` : ""}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return back("?err=auth");
  if (!can(actor.role, "manageOrganizations")) return back("?err=perm");

  const op = String(fd.get("op") ?? "");
  const g = (k: string) => String(fd.get(k) ?? "").trim();

  // Shared field parse for create/update.
  const name = g("name");
  const slug = slugify(g("slug") || name);
  const fields = {
    name,
    legalName: g("legalName") || null,
    status: g("status") === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
    primaryHost: host(g("primaryHost")),
    logoUrl: g("logoUrl") || null,
    secondaryLogoUrl: g("secondaryLogoUrl") || null,
    faviconUrl: g("faviconUrl") || null,
    primaryColor: hex(g("primaryColor")),
    accentColor: hex(g("accentColor")),
    fromName: g("fromName") || null,
    fromEmail: g("fromEmail") || null,
    supportEmail: g("supportEmail") || null,
    supportPhone: g("supportPhone") || null,
    smsBrand: g("smsBrand") || null,
    timezone: g("timezone") || "America/Phoenix",
    currency: (g("currency") || "usd").toLowerCase(),
  };

  switch (op) {
    case "create": {
      if (!name || !slug) return back("?err=fields");
      // Slug and host must be unique.
      const clash = await prisma.organization.findFirst({
        where: { OR: [{ slug }, ...(fields.primaryHost ? [{ primaryHost: fields.primaryHost }] : [])] },
        select: { id: true, slug: true },
      });
      if (clash) return back("?err=dupe");

      const org = await prisma.organization.create({ data: { slug, ...fields } });
      await audit({ actorId: actor.userId, entityType: "Organization", entityId: org.id, action: "CREATE", summary: `Created organization ${org.name} (${org.slug})` });
      return back("?ok=created", org.id);
    }

    case "update": {
      const id = g("id");
      if (!id) return back("?err=fields");
      const existing = await prisma.organization.findUnique({ where: { id } });
      if (!existing) return back("?err=notfound");

      // Guard uniqueness against OTHER orgs.
      const clash = await prisma.organization.findFirst({
        where: {
          id: { not: id },
          OR: [{ slug }, ...(fields.primaryHost ? [{ primaryHost: fields.primaryHost }] : [])],
        },
        select: { id: true },
      });
      if (clash) return back("?err=dupe", id);

      // The primary org (PURE) can't be renamed off its slug or suspended — it's
      // the platform fallback tenant.
      const data = existing.isPrimary ? { ...fields, slug: existing.slug, status: "ACTIVE" } : { slug, ...fields };
      const org = await prisma.organization.update({ where: { id }, data });
      await audit({ actorId: actor.userId, entityType: "Organization", entityId: org.id, action: "UPDATE", summary: `Updated organization ${org.name}` });
      return back("?ok=saved", id);
    }

    default:
      return back("?err=op");
  }
}
