import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { CoachProfileForm } from "@/components/CoachProfileForm";

export const dynamic = "force-dynamic";

function parseMarkets(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export default async function EditCoachPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !can(session.role, "manageCoaches")) redirect("/console");
  const ticket = await mintConsoleTicket();

  const coach = await prisma.coach.findUnique({
    where: { id },
    include: { person: true, availabilityBlocks: { orderBy: { dayOfWeek: "asc" } } },
  });
  if (!coach) redirect("/console/coaches?err=notfound");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit coach — ${coach.person.firstName} ${coach.person.lastName}`}
        subtitle="Update certification, availability, and contact on this coach's behalf."
      />
      <Link href="/console/coaches" className="text-sm text-slate-500 hover:underline">← Back to coaches</Link>
      <CoachProfileForm
        ticket={ticket}
        email={coach.person.email ?? ""}
        targetPersonId={coach.personId}
        initial={{
          phone: coach.person.phone ?? "",
          rpoCertLevel: coach.rpoCertLevel ?? "",
          certifications: coach.certifications ?? "",
          bio: coach.bio ?? "",
          coachingLevels: coach.coachingLevels ?? "",
          markets: parseMarkets(coach.marketsCovered),
          availability: coach.availabilityBlocks.map((b) => ({
            dayOfWeek: b.dayOfWeek,
            startTime: b.startTime,
            endTime: b.endTime,
          })),
        }}
      />
    </div>
  );
}
