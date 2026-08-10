import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { formatDate } from "@/lib/time";
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
export default async function EditCoachPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const { ok } = await searchParams;
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
      {ok === "account" && (
        <div className="rounded-lg bg-accent-50 px-4 py-3 text-sm text-accent-800">
          Coach account created and an invite to set their password was emailed. Complete their profile below — certification, screening, markets, and day/time availability — then save.
        </div>
      )}
      {ok === "profile" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Coach profile saved.</div>
      )}
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
          safeSport: coach?.safeSportCertified ?? false,
          backgroundCheck: !!coach?.backgroundCheckDate,
          backgroundCheckDate: coach?.backgroundCheckDate ? new Date(coach.backgroundCheckDate).toISOString().slice(0, 10) : "",
          backgroundCheckCompany: coach?.backgroundCheckCompany ?? "",
          w9: {
            onFile: coach?.w9OnFile ?? false,
            receivedAt: coach?.w9ReceivedAt ? formatDate(coach.w9ReceivedAt) : "",
            name: coach?.w9Name ?? "",
            businessName: coach?.w9BusinessName ?? "",
            taxClass: coach?.w9TaxClass ?? "",
            llcClass: coach?.w9LlcClass ?? "",
            otherClass: coach?.w9OtherClass ?? "",
            address: coach?.w9Address ?? "",
            city: coach?.w9City ?? "",
            state: coach?.w9State ?? "",
            zip: coach?.w9Zip ?? "",
            tinType: coach?.w9TinType ?? "",
            tinLast4: coach?.w9TinLast4 ?? "",
            signedName: coach?.w9SignedName ?? "",
          },
        }}
        pay={{
          seasonRate: coach?.seasonPayCents != null ? (coach.seasonPayCents / 100).toFixed(2) : "",
          seasonPct: coach?.seasonPayPct != null ? String(coach.seasonPayPct) : "",
          lessonRate: coach?.lessonPayCents != null ? (coach.lessonPayCents / 100).toFixed(2) : "",
          lessonPct: coach?.lessonPayPct != null ? String(coach.lessonPayPct) : "",
          clinicRate: coach?.clinicPayCents != null ? (coach.clinicPayCents / 100).toFixed(2) : "",
          clinicPct: coach?.clinicPayPct != null ? String(coach.clinicPayPct) : "",
          notes: coach?.payNotes ?? "",
        }}
      />
    </div>
  );
}
