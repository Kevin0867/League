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

  // Setup health per org — computed from its own config fields (truthful today,
  // no per-tenant business data required). Green when the piece is configured.
  const health = (o: (typeof orgs)[number]) => [
    { label: "Branding", ok: !!(o.logoUrl && o.primaryColor) },
    { label: "Domain", ok: !!o.primaryHost },
    { label: "Email identity", ok: !!o.fromEmail },
    { label: "Payments", ok: !!o.stripeAccountId },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mission Control"
        subtitle="Every licensed organization runs on this one platform. Click into any org to manage its branding, domain, and identity."
      />

      {/* The core SaaS promise: one codebase, one deploy — every feature and fix
          ships to all orgs at once. */}
      <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-4 py-3 text-sm text-brand-900">
        <span className="font-semibold">One platform, every org.</span>{" "}
        These are all the organizations licensed on PURE Play OS. There&apos;s a single shared codebase — every update
        and fix you ship reaches all of them automatically. Each org keeps its own branding, domain, and data.
      </div>

      {sp.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {sp.ok === "created" ? "Organization created." : "Changes saved."}
        </p>
      )}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>}

      {/* Org cards — click any to open its detail/config. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {orgs.map((o) => (
          <Link
            key={o.id}
            href={`/console/organizations/${o.id}`}
            className="group card flex flex-col gap-3 transition-shadow hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-sm font-bold text-white ring-1 ring-black/5"
                  style={{ background: o.primaryColor ?? "#2c4670" }}
                >
                  {o.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-slate-900 group-hover:text-brand-700">{o.name}</span>
                    {o.isPrimary && <span className="badge bg-brand-100 text-brand-800">Primary</span>}
                  </div>
                  <div className="truncate text-xs text-slate-400">{o.slug}</div>
                </div>
              </div>
              <span className={`badge ${o.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {o.status.toLowerCase()}
              </span>
            </div>

            <div className="text-xs text-slate-500">
              <span className="font-medium text-slate-600">Routing:</span>{" "}
              {o.primaryHost ? o.primaryHost : <span className="text-slate-400">{o.slug}.pureplayos.app (default)</span>}
            </div>

            <div className="mt-auto flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
              {health(o).map((h) => (
                <span
                  key={h.label}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    h.ok ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-slate-50 text-slate-400 ring-1 ring-slate-100"
                  }`}
                >
                  {h.ok ? "✓" : "○"} {h.label}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      <div>
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Add an organization</h2>
        <p className="mb-3 text-sm text-slate-500">Spin up a new self-branded tenant — a school, club, or company. It inherits every feature on the platform; you just set its branding, domain, and identity.</p>
        <OrgForm ticket={ticket} />
      </div>
    </div>
  );
}
