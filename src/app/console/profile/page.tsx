import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { CoachProfileForm } from "@/components/CoachProfileForm";
import { ImageUploadForm } from "@/components/ImageUploadForm";
import { PasswordField } from "@/components/PasswordField";

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
      <PageHeader title="My account" subtitle="Your sign-in, password, and profile details." />
      {sp.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Profile saved.</p>}
      {sp.imgok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Profile photo updated.</p>}
      {sp.imgerr && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{sp.imgerr}</p>}
      {sp.err === "noperson" && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Your login isn&apos;t linked to a person record — contact an administrator.</p>
      )}

      <div className="card">
        <h2 className="mb-1 font-semibold text-slate-900">Change password</h2>
        <p className="mb-3 text-sm text-slate-500">Update the password you use to sign in.</p>
        {sp.pwok && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Password updated.</p>}
        {sp.pwerr && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {sp.pwerr === "current"
              ? "Your current password is incorrect."
              : sp.pwerr === "short"
              ? "New password must be at least 8 characters."
              : sp.pwerr === "mismatch"
              ? "The new passwords don't match."
              : sp.pwerr === "fields"
              ? "Fill in your current and new password."
              : "Couldn't update your password — please sign in again and retry."}
          </p>
        )}
        <form method="POST" action="/api/console/change-password" className="max-w-sm space-y-4">
          <input type="hidden" name="ticket" value={ticket} />
          <PasswordField name="currentPassword" label="Current password" minLength={0} autoComplete="current-password" />
          <PasswordField name="newPassword" label="New password" confirm hint="At least 8 characters." autoComplete="new-password" />
          <button type="submit" className="btn-primary">Update password</button>
        </form>
      </div>

      {coach && person && (
        <div className="card">
          <h2 className="mb-1 font-semibold text-slate-900">Profile photo</h2>
          <p className="mb-3 text-sm text-slate-500">Shown on the public coaches page. JPG, PNG, or WebP up to 8 MB.</p>
          <ImageUploadForm ticket={ticket} returnTo="/console/profile" currentUrl={person.imageUrl} name={`${person.firstName} ${person.lastName}`} />
        </div>
      )}
      {coach && (
      <CoachProfileForm
        ticket={ticket}
        email={session?.email ?? ""}
        initial={{
          phone: person?.phone ?? "",
          rpoCertLevel: coach?.rpoCertLevel ?? "",
          certifications: coach?.certifications ?? "",
          bio: coach?.bio ?? "",
          coachingLevels: coach?.coachingLevels ?? "",
          publicHidden: coach?.publicHidden ?? [],
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
      )}
    </div>
  );
}
