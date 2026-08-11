import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { TableFilter } from "@/components/TableFilter";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { ROLE_LABELS, ADMIN_ROLES, ASSIGNABLE_ROLES, effectiveRoles, type Role } from "@/lib/enums";

// De-duplicated, human labels for a role set (legacy COO/CEO/DIRECTOR all show
// as "Admin", so collapse duplicates).
function roleLabels(roles: Role[]): string[] {
  return [...new Set(roles.map((r) => ROLE_LABELS[r] ?? r))];
}

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  auth: "Not authorized to manage access.",
  role: "That role can't be assigned.",
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
  const isAdmin = (session?.roles ?? [session?.role]).some((r) => ADMIN_ROLES.includes((r ?? "") as never));

  const users = await prisma.user.findMany({
    include: { person: true },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });

  const assignableRoles = ASSIGNABLE_ROLES;

  return (
    <div className="space-y-6">
      <PageHeader title="Access" subtitle="Invite people and assign roles. Admins can do anything; coaches are scoped to their own teams; players and parents use the family portal." />
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
              {assignableRoles.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
        </div>
        <button type="submit" className="btn-primary">Send invite</button>
      </form>

      <div className="max-w-md">
        <TableFilter targetId="users-table" placeholder="Search by name or email…" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table id="users-table" className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="hidden px-4 py-3 sm:table-cell">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="hidden px-4 py-3 sm:table-cell">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const isSelf = u.id === session?.userId;
              // Admins can change anyone's role except their own (self-lockout guard).
              const locked = isSelf || !isAdmin;
              const assignable = assignableRoles;
              return (
                <tr key={u.id} data-filter-row data-filter-text={`${u.person ? `${u.person.firstName} ${u.person.lastName}` : ""} ${u.email}`}>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {u.person ? `${u.person.firstName} ${u.person.lastName}` : "—"}
                    {isSelf && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-500 sm:table-cell">{u.email}</td>
                  <td className="px-4 py-3">
                    {locked ? (
                      <div className="flex flex-wrap gap-1">
                        {roleLabels(effectiveRoles(u)).map((label) => (
                          <span key={label} className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{label}</span>
                        ))}
                      </div>
                    ) : (
                      <form method="POST" action="/api/console/users" className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="setRoles" />
                        <input type="hidden" name="userId" value={u.id} />
                        <div className="flex flex-wrap gap-2">
                          {assignable.map((r) => {
                            const checked = effectiveRoles(u).includes(r);
                            return (
                              <label key={r} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                                <input type="checkbox" name="roles" value={r} defaultChecked={checked} className="h-3.5 w-3.5" />
                                {ROLE_LABELS[r]}
                              </label>
                            );
                          })}
                        </div>
                        <button className="btn-secondary text-xs">Save</button>
                      </form>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <span className={`rounded px-2 py-1 text-xs font-medium ${u.active ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                      {u.active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!isSelf && isAdmin && (
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
            <tr data-filter-empty hidden><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No users match your search.</td></tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Need to create a new coach or staff login? Use <span className="font-medium">Coaches → Add account</span>.
      </p>
    </div>
  );
}
