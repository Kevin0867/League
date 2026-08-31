import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/RoadmapNote";
import { OrgForm } from "../OrgForm";

export const dynamic = "force-dynamic";

export default async function EditOrganizationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await getSession();
  if (!session || !can(session.role, "manageOrganizations")) redirect("/console");
  const ticket = await mintConsoleTicket();

  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) redirect("/console/organizations?err=notfound");

  return (
    <div className="space-y-6">
      <Link href="/console/organizations" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
        ← Back to Mission Control
      </Link>
      <PageHeader
        title={org.name}
        subtitle={org.isPrimary ? "The primary org — this platform's main site. Its slug is locked and it can't be suspended." : "This tenant's branding, domain, and communications identity."}
      />

      {sp.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Changes saved.</p>}
      {sp.err === "dupe" && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">That slug or domain is already used by another organization.</p>}

      {/* Enter the app — the org's live workspace is served on its own hostname.
          PURE (primary) IS this console, so it opens directly; another tenant
          opens at its domain. Full per-tenant data isolation lands in Phase 2. */}
      <div className="card">
        <h2 className="font-semibold text-slate-900">Open the app</h2>
        {org.isPrimary ? (
          <>
            <p className="mt-1 text-sm text-slate-500">
              {org.name} is the primary org, so its application is <strong>this console</strong> — the data you see here is {org.name}&apos;s.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/console" className="btn-primary text-sm">Open {org.name} console →</Link>
              <a href={org.primaryHost ? `https://${org.primaryHost}` : "/"} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">
                View public site →
              </a>
            </div>
          </>
        ) : org.primaryHost ? (
          <>
            <p className="mt-1 text-sm text-slate-500">
              {org.name}&apos;s app is served on its own domain. Opening it shows {org.name}&apos;s branded site and console.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`https://${org.primaryHost}`} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm">
                Open {org.primaryHost} →
              </a>
            </div>
            <p className="mt-2 text-xs text-amber-700">
              Note: full per-tenant data isolation ships with Phase 2 — until then, tenants share the primary org&apos;s data.
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            Set a domain below to give {org.name} its own address. A dedicated workspace with its own isolated data opens once
            data isolation (Phase 2) ships; for now, edit its branding and identity here.
          </p>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-500">Branding, domain, and communications identity for {org.name}.</p>
        <OrgForm ticket={ticket} org={org} />
      </div>
    </div>
  );
}
