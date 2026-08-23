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
        ← Back to Organizations
      </Link>
      <PageHeader
        title={`Edit — ${org.name}`}
        subtitle={org.isPrimary ? "The primary org (the main site). Its slug is locked and it can't be suspended." : "Branding, domain, and communications identity for this tenant."}
      />

      {sp.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Changes saved.</p>}
      {sp.err === "dupe" && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">That slug or domain is already used by another organization.</p>}

      <OrgForm ticket={ticket} org={org} />
    </div>
  );
}
