import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { PageHeader } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatTime12, phoenixDateInput } from "@/lib/time";
import { phoenixHHMM } from "@/lib/domain/courtHold";
import { LessonManageControls, type ManageBooking } from "@/components/LessonManageControls";

export const dynamic = "force-dynamic";
export const metadata = { title: "My upcoming lessons" };

const LERR: Record<string, string> = {
  notfound: "Lesson not found.",
  auth: "That isn't your lesson to change.",
  cancelled: "That lesson is already cancelled.",
  nofacility: "Pick a location.",
  badtime: "Enter a valid date and time.",
  op: "Unknown action.",
};

export default async function CoachLessonsSchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  const personId = session.personId ?? "";
  if (!personId) redirect("/console/profile?err=noperson");

  const coach = await prisma.coach.findUnique({ where: { personId }, select: { id: true } });
  const ticket = await mintConsoleTicket();

  const now = new Date();
  const horizonPast = new Date(now.getTime() - 2 * 60 * 60 * 1000); // keep just-passed ones briefly
  const bookings = coach
    ? await prisma.alaCarteBooking.findMany({
        where: {
          coachId: coach.id,
          seriesId: { not: null },
          status: { in: ["REQUESTED", "ACCEPTED", "DELIVERED"] },
          scheduledAt: { gte: horizonPast },
        },
        include: { offering: { select: { title: true } }, client: { select: { firstName: true, lastName: true } } },
        orderBy: { scheduledAt: "asc" },
        take: 100,
      })
    : [];

  const facilities = await prisma.facility.findMany({ where: { archived: false, alaCarteAllowed: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const facName = new Map(facilities.map((f) => [f.id, f.name]));

  const lok = sp.lok;
  const lerr = sp.lerr ? (LERR[sp.lerr] ?? decodeURIComponent(sp.lerr)) : null;

  return (
    <div className="space-y-6">
      <PageHeader title="My upcoming lessons" subtitle="Reschedule, relocate, or cancel a booked lesson. The player and the office are notified automatically whenever you make a change." />

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/console/profile/lessons" className="btn-ghost">← Lesson setup &amp; pricing</Link>
      </div>

      {lok === "moved" && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Lesson moved — the player has been notified.</p>}
      {lok === "cancelled" && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Lesson cancelled — the player has been notified.</p>}
      {lerr && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{lerr}</p>}

      <div className="card">
        {!coach || bookings.length === 0 ? (
          <p className="text-sm text-slate-400">No upcoming lessons booked. When a player books you through PURE, it shows up here.</p>
        ) : (
          <div className="space-y-2">
            {bookings.map((b) => {
              const mb: ManageBooking = {
                id: b.id, scheduledAt: b.scheduledAt, facilityId: b.facilityId,
                offeringTitle: b.offering?.title ?? null, clientName: `${b.client.firstName} ${b.client.lastName}`.trim(), status: b.status,
              };
              return (
                <div key={b.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-medium text-slate-800">{b.offering?.title ?? "Lesson"}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {b.client.firstName} {b.client.lastName}
                        {b.scheduledAt ? ` · ${formatDate(new Date(`${phoenixDateInput(b.scheduledAt)}T12:00:00Z`))} ${formatTime12(phoenixHHMM(b.scheduledAt))}` : ""}
                        {b.facilityId ? ` · ${facName.get(b.facilityId) ?? ""}` : ""}
                      </span>
                    </div>
                    <StatusBadge status={b.status} />
                  </div>
                  <LessonManageControls booking={mb} facilities={facilities} ticket={ticket} returnTo="/console/profile/lessons/schedule" isAdmin={false} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
