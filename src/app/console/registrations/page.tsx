import Link from "next/link";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { findDuplicateGroups } from "@/lib/domain/registrations";

export const dynamic = "force-dynamic";

export default async function RegistrationsPage() {
  const registrations = await prisma.registration.findMany({
    include: { person: true, division: true, locationPrefs: { orderBy: { rank: "asc" }, include: { facility: true } } },
    orderBy: { submittedAt: "desc" },
  });

  const people = registrations.map((r) => ({
    id: r.person.id,
    firstName: r.person.firstName,
    lastName: r.person.lastName,
    email: r.person.email,
    phone: r.person.phone,
  }));
  const dupGroups = findDuplicateGroups(people);

  const counts = {
    total: registrations.length,
    assigned: registrations.filter((r) => r.status === "ASSIGNED").length,
    waitlisted: registrations.filter((r) => r.status === "WAITLISTED").length,
    noWaiver: registrations.filter((r) => !r.person.waiverSignedAt).length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Registrations</h1>
        <p className="text-slate-500">
          {counts.total} total · {counts.assigned} assigned · {counts.waitlisted} waitlisted ·{" "}
          <span className={counts.noWaiver ? "text-amber-600 font-medium" : ""}>{counts.noWaiver} without waiver</span>
        </p>
      </div>

      {dupGroups.length > 0 && (
        <div className="card border-l-4 border-amber-400">
          <h2 className="font-semibold text-amber-800">
            Possible duplicates ({dupGroups.length} group{dupGroups.length > 1 ? "s" : ""})
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Match on name plus email or phone. Merge to the highest band registered
            while preserving all location and time preferences (§3).
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {dupGroups.map((g, i) => (
              <li key={i} className="rounded-lg bg-amber-50 px-3 py-2">
                {g.map((p) => `${p.firstName} ${p.lastName}`).join("  ·  ")}
                <span className="ml-2 text-xs text-slate-500">
                  ({g.map((p) => p.email ?? p.phone ?? "—").join(", ")})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-2">Player</th>
              <th>Division</th>
              <th>Location prefs</th>
              <th>Waiver</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {registrations.map((r) => (
              <tr key={r.id}>
                <td className="py-2">
                  <Link href={`/console/people/${r.person.id}`} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                    {r.person.firstName} {r.person.lastName}
                  </Link>
                  <div className="text-xs text-slate-400">{r.person.email ?? r.person.phone ?? "—"}</div>
                </td>
                <td className="text-slate-600">{r.division?.name ?? <span className="text-slate-400">unplaced</span>}</td>
                <td className="text-slate-600">
                  {r.locationPrefs.length
                    ? r.locationPrefs.map((lp) => lp.facility?.name ?? lp.marketName).filter(Boolean).join(" › ")
                    : "—"}
                </td>
                <td>
                  {r.person.waiverSignedAt
                    ? <span className="badge bg-emerald-100 text-emerald-800">signed</span>
                    : <span className="badge bg-amber-100 text-amber-800">outstanding</span>}
                </td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {registrations.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-slate-400">No registrations yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
