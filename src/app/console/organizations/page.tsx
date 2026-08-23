import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/RoadmapNote";
import { OrgForm } from "./OrgForm";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  auth: "Not signed in.",
  perm: "You don't have permission to manage organizations.",
  fields: "Name is required.",
  dupe: "That slug or domain is already used by another organization.",
  notfound: "Organization not found.",
  op: "Unknown operation.",
};

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session || !can(session.role, "manageOrganizations")) redirect("/console");
  const ticket = await mintConsoleTicket();

  const orgs = await prisma.organization.findMany({ orderBy: [{ isPrimary: "desc" }, { name: "asc" }] });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        subtitle="Each licensed customer runs on this same platform — one deployment, updated for everyone at once. PURE is the primary org; add a school, club, or company as a new self-branded org."
      />

      {sp.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {sp.ok === "created" ? "Organization created." : "Changes saved."}
        </p>
      )}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>}

      <div className="card">
        <h2 className="mb-3 font-semibold text-slate-900">Licensed organizations</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr><th className="py-2">Organization</th><th>Slug</th><th>Domain</th><th>Status</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-full ring-1 ring-slate-200" style={{ background: o.primaryColor ?? "#2c4670" }} />
                      <Link href={`/console/organizations/${o.id}`} className="font-medium text-brand-700 hover:underline">{o.name}</Link>
                      {o.isPrimary && <span className="badge bg-brand-100 text-brand-800">Primary</span>}
                    </div>
                  </td>
                  <td className="text-slate-500">{o.slug}</td>
                  <td className="text-slate-500">{o.primaryHost ?? <span className="text-slate-300">{o.slug}.·</span>}</td>
                  <td>
                    <span className={`badge ${o.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{o.status.toLowerCase()}</span>
                  </td>
                  <td className="text-right"><Link href={`/console/organizations/${o.id}`} className="text-sm text-brand-700 hover:underline">Edit</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Add an organization</h2>
        <OrgForm ticket={ticket} />
      </div>
    </div>
  );
}
