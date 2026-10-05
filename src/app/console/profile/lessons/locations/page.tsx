import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { PageHeader } from "@/components/RoadmapNote";
import { LessonLocationForm } from "@/components/LessonLocationForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lesson locations" };

const OKS: Record<string, string> = { added: "Location added.", saved: "Location saved.", removed: "Removed from lesson locations." };
const ERRS: Record<string, string> = { auth: "Only admins can manage lesson locations.", name: "Enter a location name.", email: "Enter a valid contact email.", hours: "Each hours window's end must be after its start.", day: "Pick a valid day.", missing: "Location not found." };

export default async function LessonLocationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  // Lesson locations are physical venues with contacts/agreements — admin-managed.
  if (!isAdmin(session.roles ?? [session.role])) redirect("/console/profile/lessons");
  const ticket = await mintConsoleTicket();

  const facilities = await prisma.facility.findMany({
    where: { alaCarteAllowed: true, archived: false },
    select: { id: true, name: true, generalArea: true, courtCount: true, primaryContact: true, contactEmail: true, contactPhone: true, courtBlocks: { where: { kind: "AVAILABLE" }, select: { dayOfWeek: true, startTime: true, endTime: true, courtCount: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Lesson locations" subtitle="The venues available for private/group lessons — separate from Academy league facilities. Set each one's court contact (who PURE emails to reserve a court) and the hours courts are open for lessons." />

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/console/profile/lessons" className="btn-ghost">← Lesson setup &amp; pricing</Link>
      </div>

      {sp.ok && OKS[sp.ok] && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{OKS[sp.ok]}</p>}
      {sp.err && ERRS[sp.err] && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRS[sp.err]}</p>}

      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-900">Current lesson locations ({facilities.length})</h2>
        {facilities.length === 0 ? (
          <p className="text-sm text-slate-400">No lesson locations yet. Add one below — it&apos;ll be available for coaches to teach at and for players to book.</p>
        ) : (
          <ul className="space-y-2">
            {facilities.map((f) => {
              const hours = f.courtBlocks.map((b) => ({ day: b.dayOfWeek, start: b.startTime, end: b.endTime, courts: b.courtCount }));
              return (
                <li key={f.id} className="rounded-xl border border-slate-200">
                  <div className="px-3 pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{f.name}{f.generalArea ? <span className="ml-2 text-xs font-normal text-slate-400">{f.generalArea}</span> : null}</span>
                      <span className="text-xs text-slate-500">{f.courtCount || 1} court{f.courtCount === 1 ? "" : "s"}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Court contact: {f.contactEmail ? `${f.primaryContact ? f.primaryContact + " · " : ""}${f.contactEmail}` : <span className="text-amber-700">none set — PURE can&apos;t send court requests</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">{hours.length ? hours.map((h) => `${h.day} ${h.start}–${h.end}`).join(" · ") : "No lesson hours set — players will see no times here"}</p>
                  </div>
                  <details className="mt-2 border-t border-slate-100">
                    <summary className="btn-chip-muted m-3 inline-flex cursor-pointer list-none text-xs font-semibold [&::-webkit-details-marker]:hidden">Edit</summary>
                    <div className="px-3 pb-3">
                      <LessonLocationForm ticket={ticket} facility={{ id: f.id, name: f.name, generalArea: f.generalArea, courtCount: f.courtCount, primaryContact: f.primaryContact, contactEmail: f.contactEmail, contactPhone: f.contactPhone, hours }} />
                      <form method="POST" action="/api/console/lesson-locations" className="mt-2 text-right">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="remove" />
                        <input type="hidden" name="facilityId" value={f.id} />
                        <button className="btn-chip-danger">Remove from lesson locations</button>
                      </form>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}

        <details>
          <summary className="btn-primary inline-flex cursor-pointer list-none [&::-webkit-details-marker]:hidden">+ Add a lesson location</summary>
          <div className="mt-3 rounded-xl border border-slate-200 p-3">
            <LessonLocationForm ticket={ticket} />
          </div>
        </details>
      </div>
    </div>
  );
}
