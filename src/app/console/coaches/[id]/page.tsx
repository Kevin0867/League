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

// `id` is the coach's personId, so coaches without a Coach profile row yet are
// still editable (the save upserts one).
export default async function EditCoachPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !can(session.role, "manageCoaches")) redirect("/console");
  const ticket = await mintConsoleTicket();

  const person = await prisma.person.findUnique({
    where: { id },
    include: { coach: { include: { availabilityBlocks: { orderBy: { dayOfWeek: "asc" } } } } },
  });
  if (!person) redirect("/console/coaches?err=notfound");
  const coach = person.coach;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit coach — ${person.firstName} ${person.lastName}`}
        subtitle="Update certification, availability, and contact on this coach's behalf."
      />
      <Link href="/console/coaches" className="text-sm text-slate-500 hover:underline">← Back to coaches</Link>
      <CoachProfileForm
        ticket={ticket}
        email={person.email ?? ""}
        targetPersonId={person.id}
        initial={{
          phone: person.phone ?? "",
          rpoCertLevel: coach?.rpoCertLevel ?? "",
          certifications: coach?.certifications ?? "",
          bio: coach?.bio ?? "",
          coachingLevels: coach?.coachingLevels ?? "",
          markets: parseMarkets(coach?.marketsCovered ?? null),
          availability: (coach?.availabilityBlocks ?? []).map((b) => ({
            dayOfWeek: b.dayOfWeek,
            startTime: b.startTime,
            endTime: b.endTime,
          })),
        }}
      />
    </div>
  );
}
