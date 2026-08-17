import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { TableFilter } from "@/components/TableFilter";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { ROLE_LABELS, ADMIN_ROLES, ASSIGNABLE_ROLES, effectiveRoles, type Role } from "@/lib/enums";
import { LoginStatus } from "@/components/LoginStatus";
import { requireAdmin } from "@/lib/rbac";
import { AccessRolesProvider, RoleCell } from "./AccessRoles";

// De-duplicated, human labels for a role set (legacy COO/CEO/DIRECTOR all show
// as "Admin", so collapse duplicates).
function roleLabels(roles: Role[]): string[] {
  return [...new Set(roles.map((r) => ROLE_LABELS[r] ?? r))];
}

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  auth: "Not authorized to manage access.",
  role: "That role can't be assigned.",
  self: "You can't disable or delete your own login.",
  notfound: "User not found.",
  fields: "Missing information.",
  exists: "A user with that email already exists.",
  "invite-send": "The account was created, but the invitation email could not be sent. Check email settings, then re-send the invite.",
  lastadmin: "That's the last admin login — assign admin to someone else before removing it.",
  delete: "Couldn't delete that login. It may still be referenced elsewhere.",
};
const OKS: Record<string, string> = {
  role: "Role updated.",
  rolesBulk: "Role changes saved.",
  active: "Access updated.",
  edited: "User updated.",
  deleted: "Login deleted. The person's records were kept.",
  invited: "Invitation sent — they'll get an email to set their password.",
  "invite-resent": "Invitation re-sent — a fresh set-password link is on its way.",
  "invited-sim": "Account created, but email isn't configured on this environment, so no invitation was actually sent.",
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const session = await getSession();
  const ticket = await mintConsoleTicket();
  const isAdmin = (session?.roles ?? [session?.role]).some((r) => ADMIN_ROLES.includes((r ?? "") as never));

  const users = await prisma.user.findMany({
    include: { person: true },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });

  const assignableRoles = ASSIGNABLE_ROLES;
  // Starting role selection per user for the shared dirty-set editor: the
  // assignable roles they currently hold.
  const initialRoles: Record<string, string[]> = Object.fromEntries(
    users.map((u) => [u.id, assignableRoles.filter((r) => effectiveRoles(u).includes(r))]),
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Access" subtitle="Invite people and assign roles. Admins can do anything; coaches are scoped to their own teams; players and parents use the family portal." />
      {sp.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{OKS[sp.ok] ?? "Done."}</p>}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>}

      {/* A freshly generated set-password link, shown once for the admin to copy
          and hand off (text, in person) when email delivery isn't reliable. */}
      {sp.link && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-3 text-sm">
          <p className="font-semibold text-brand-900">Set-password link — copy it now, it won&apos;t show again.</p>
          <p className="mt-0.5 text-xs text-brand-700">Send this to the person however you like. It sets their password and signs them in. Expires in 7 days.</p>
          <input readOnly value={sp.link} className="input mt-2 w-full bg-white font-mono text-xs" />
        </div>
      )}

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

      <AccessRolesProvider initial={initialRoles} ticket={ticket}>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table id="users-table" className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="hidden px-4 py-3 sm:table-cell">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="hidden px-4 py-3 sm:table-cell">Login activity</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const isSelf = u.id === session?.userId;
              // Admins can change anyone's roles — including their own. The route
              // still blocks stripping the last admin, so no one can lock the org
              // out. Only disabling/deleting your OWN login is barred (below).
              const locked = !isAdmin;
              const assignable = assignableRoles;
              return (
                <tr key={u.id} data-filter-row data-filter-text={`${u.person ? `${u.person.firstName} ${u.person.lastName}` : ""} ${u.email}`}>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {u.person ? (
                      <Link href={`/console/people/${u.person.id}`} className="text-slate-800 hover:text-brand-700 hover:underline">
                        {u.person.firstName} {u.person.lastName}
                      </Link>
                    ) : "—"}
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
                      <RoleCell userId={u.id} assignable={assignable} />
                    )}
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <LoginStatus lastLoginAt={u.lastLoginAt} active={u.active} />
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    {isAdmin && (
                      <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center justify-end gap-3">
                          {!u.lastLoginAt && !isSelf && (
                            <form method="POST" action="/api/console/users">
                              <input type="hidden" name="ticket" value={ticket} />
                              <input type="hidden" name="op" value="resendInvite" />
                              <input type="hidden" name="userId" value={u.id} />
                              <button className="text-xs font-semibold text-brand-700 hover:underline" title="Email a fresh set-password link">Resend invite</button>
                            </form>
                          )}
                          {/* Can't disable your own login out from under yourself. */}
                          {!isSelf && (
                            <form method="POST" action="/api/console/users">
                              <input type="hidden" name="ticket" value={ticket} />
                              <input type="hidden" name="op" value="toggleActive" />
                              <input type="hidden" name="userId" value={u.id} />
                              <input type="hidden" name="active" value={u.active ? "false" : "true"} />
                              <button className="text-xs text-slate-500 hover:underline">{u.active ? "Disable" : "Enable"}</button>
                            </form>
                          )}
                        </div>

                        {/* Full management — edit identity, copy a set-password
                            link, delete the login — tucked behind a disclosure so
                            the row stays uncluttered. */}
                        <details className="w-full text-left">
                          <summary className="cursor-pointer list-none text-xs font-semibold text-slate-500 hover:text-slate-700">⚙ Manage ▾</summary>
                          <div className="mt-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            {/* Edit identity */}
                            <form method="POST" action="/api/console/users" className="space-y-2">
                              <input type="hidden" name="ticket" value={ticket} />
                              <input type="hidden" name="op" value="editUser" />
                              <input type="hidden" name="userId" value={u.id} />
                              <div className="grid gap-2 sm:grid-cols-2">
                                <div><label className="label">First name</label><input name="firstName" className="input py-1 text-sm" defaultValue={u.person?.firstName ?? ""} required /></div>
                                <div><label className="label">Last name</label><input name="lastName" className="input py-1 text-sm" defaultValue={u.person?.lastName ?? ""} required /></div>
                                <div><label className="label">Login email</label><input name="email" type="email" className="input py-1 text-sm" defaultValue={u.email} required /></div>
                                <div><label className="label">Phone</label><input name="phone" type="tel" className="input py-1 text-sm" defaultValue={u.person?.phone ?? ""} /></div>
                              </div>
                              <button className="btn-secondary text-xs">Save changes</button>
                            </form>

                            {/* Copy a set-password link (no email needed) */}
                            <form method="POST" action="/api/console/users">
                              <input type="hidden" name="ticket" value={ticket} />
                              <input type="hidden" name="op" value="inviteLink" />
                              <input type="hidden" name="userId" value={u.id} />
                              <button className="text-xs font-semibold text-brand-700 hover:underline" title="Generate a link to copy and send yourself">Get set-password link</button>
                            </form>

                            {/* Delete — guarded behind a second disclosure so it's deliberate. Hidden for your own login. */}
                            {!isSelf && (
                            <details className="border-t border-slate-200 pt-2">
                              <summary className="cursor-pointer list-none text-xs font-semibold text-rose-600 hover:text-rose-700">Delete this login…</summary>
                              <div className="mt-2 space-y-2">
                                <p className="text-xs text-slate-500">Removes their sign-in only. Their records (registrations, team, coach profile) are kept. This can&apos;t be undone.</p>
                                <form method="POST" action="/api/console/users">
                                  <input type="hidden" name="ticket" value={ticket} />
                                  <input type="hidden" name="op" value="deleteUser" />
                                  <input type="hidden" name="userId" value={u.id} />
                                  <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700">Delete login for {u.person ? u.person.firstName : u.email}</button>
                                </form>
                              </div>
                            </details>
                            )}
                          </div>
                        </details>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr data-filter-empty hidden><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No users match your search.</td></tr>
          </tbody>
        </table>
      </div>
      </AccessRolesProvider>

      <p className="text-xs text-slate-400">
        Need to create a new coach or staff login? Use <span className="font-medium">Coaches → Add account</span>.
      </p>
    </div>
  );
}
