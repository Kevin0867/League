import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { ROLE_LABELS, ADMIN_ROLES, type Role } from "@/lib/enums";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  auth: "Not authorized to manage access.",
  role: "Only the COO can grant or change admin roles (COO / CEO / Director).",
  self: "You can't change your own access.",
  notfound: "User not found.",
  fields: "Missing information.",
  exists: "A user with that email already exists.",
};
const OKS: Record<string, string> = {
  role: "Role updated.",
  active: "Access updated.",
  invited: "Invitation sent — they'll get an email to set their password.",
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  const ticket = await mintConsoleTicket();
  const isCOO = session?.role === "COO";

  const users = await prisma.user.findMany({
    include: { person: true },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });

  const allRoles = Object.keys(ROLE_LABELS) as Role[];

  return (
    <div className="space-y-6">
      <PageHeader title="Access" subtitle="Invite people and assign roles. Admin roles (COO, CEO, Director) can only be granted by the COO." />
      {sp.ok && <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">{OKS[sp.ok] ?? "Done."}</p>}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>}

      {/* Invite a new user */}
      <form method="POST" action="/api/console/users" className="card space-y-4">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="invite" />
        <div>
          <h2 className="font-semibold text-slate-900">Invite someone</h2>
          <p className="text-sm text-slate-500">They&apos;ll get an email to set their password and sign in.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div><label className="label">First name</label><input name="firstName" className="input" required /></div>
          <div><label className="label">Last name</label><input name="lastName" className="input" required /></div>
          <div><label className="label">Email</label><input name="email" type="email" className="input" required /></div>
          <div>
            <label className="label">Role</label>
            <select name="role" className="input" defaultValue="COACH">
              {(isCOO ? allRoles : allRoles.filter((r) => !ADMIN_ROLES.includes(r as never))).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
        </div>
        <button type="submit" className="btn-primary">Send invite</button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const isSelf = u.id === session?.userId;
              const targetIsAdmin = ADMIN_ROLES.includes(u.role as never);
              // A DIRECTOR can't touch admin accounts and can only assign non-admin roles.
              const locked = isSelf || (!isCOO && targetIsAdmin);
              const assignable = isCOO ? allRoles : allRoles.filter((r) => !ADMIN_ROLES.includes(r as never));
              return (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {u.person ? `${u.person.firstName} ${u.person.lastName}` : "—"}
                    {isSelf && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{u.email}</td>
                  <td className="px-4 py-3">
                    {locked ? (
                      <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{ROLE_LABELS[u.role as Role] ?? u.role}</span>
                    ) : (
                      <form method="POST" action="/api/console/users" className="flex items-center gap-2">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="setRole" />
                        <input type="hidden" name="userId" value={u.id} />
                        <select name="role" defaultValue={u.role} className="input py-1 text-sm">
                          {assignable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                        <button className="btn-secondary text-xs">Save</button>
                      </form>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-1 text-xs font-medium ${u.active ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                      {u.active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!isSelf && (!targetIsAdmin || isCOO) && (
                      <form method="POST" action="/api/console/users">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="toggleActive" />
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="active" value={u.active ? "false" : "true"} />
                        <button className="text-xs text-slate-500 hover:underline">{u.active ? "Disable" : "Enable"}</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Need to create a new coach or staff login? Use <span className="font-medium">Coaches → Add account</span>.
      </p>
    </div>
  );
}
