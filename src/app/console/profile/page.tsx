import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { getSession, mintConsoleTicket } from "@/lib/auth";
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

export default async function CoachProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  const ticket = await mintConsoleTicket();

  const person = session?.personId
    ? await prisma.person.findUnique({
        where: { id: session.personId },
        include: {
          coach: { include: { availabilityBlocks: { orderBy: { dayOfWeek: "asc" } } } },
        },
      })
    : null;

  const coach = person?.coach ?? null;

  return (
    <div className="space-y-6">
      <PageHeader title="My coach profile" subtitle="Keep your certification, availability, and contact details current." />
      {sp.ok && <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">Profile saved.</p>}
      {sp.err === "noperson" && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Your login isn&apos;t linked to a person record — contact an administrator.</p>
      )}
      <CoachProfileForm
        ticket={ticket}
        email={session?.email ?? ""}
        initial={{
          phone: person?.phone ?? "",
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
          safeSport: coach?.safeSportCertified ?? false,
          backgroundCheck: !!coach?.backgroundCheckDate,
          backgroundCheckDate: coach?.backgroundCheckDate ? new Date(coach.backgroundCheckDate).toISOString().slice(0, 10) : "",
          backgroundCheckCompany: coach?.backgroundCheckCompany ?? "",
        }}
      />
    </div>
  );
}
