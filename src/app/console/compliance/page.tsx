import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CompliancePage() {
  const [peopleNoWaiver, coaches, mediaOptOuts, unverifiedDupr] = await Promise.all([
    prisma.person.findMany({
      where: { waiverSignedAt: null, registrations: { some: {} } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        registrations: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.coach.findMany({ include: { person: true } }),
    prisma.person.count({ where: { mediaOptOut: true } }),
    prisma.person.count({ where: { duprId: { not: null }, duprVerified: false } }),
  ]);

  const now = new Date();
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);

  const bgExpiring = coaches.filter(
    (c) => c.backgroundCheckExpiry && c.backgroundCheckExpiry <= in30
  );
  const bgMissing = coaches.filter((c) => !c.backgroundCheckDate);
  const onboardingMissing = coaches.filter((c) => !c.onboardingCompletedAt);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Compliance dashboard</h1>
        <p className="text-slate-500">Waivers, background checks, certifications, media opt-outs.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Waivers outstanding" value={peopleNoWaiver.length} warn={peopleNoWaiver.length > 0} />
        <Metric label="Background checks expired / expiring (30d)" value={bgExpiring.length} warn={bgExpiring.length > 0} />
        <Metric label="Coaches without onboarding" value={onboardingMissing.length} warn={onboardingMissing.length > 0} />
        <Metric label="Unverified DUPR IDs" value={unverifiedDupr} warn={unverifiedDupr > 0} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Waivers outstanding" subtitle="No court-ready roster without a signed waiver (§3).">
          {peopleNoWaiver.length === 0 ? (
            <Ok text="All registered players have a waiver on file." />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {peopleNoWaiver.map((p) => {
                const regId = p.registrations[0]?.id;
                const href = regId ? `/console/registrations/${regId}` : `/console/people/${p.id}`;
                return (
                  <li key={p.id} className="flex items-center justify-between py-2">
                    <Link href={href} className="font-medium text-slate-700 hover:text-brand-700 hover:underline">
                      {p.firstName} {p.lastName}
                    </Link>
                    <span className="flex items-center gap-2 text-xs text-slate-400">
                      {p.email ?? "—"}
                      <span className="text-brand-600">Send waiver →</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Coach screening gate" subtitle="No team assignment without background check + onboarding (§5).">
          {coaches.length === 0 ? (
            <Ok text="No coaches on file yet." />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {coaches.map((c) => {
                const issues: string[] = [];
                if (!c.backgroundCheckDate) issues.push("no background check");
                else if (c.backgroundCheckExpiry && c.backgroundCheckExpiry <= now) issues.push("bg check expired");
                else if (c.backgroundCheckExpiry && c.backgroundCheckExpiry <= in30) issues.push("bg check expiring");
                if (!c.onboardingCompletedAt) issues.push("onboarding incomplete");
                return (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <Link href={`/console/coaches/${c.person.id}`} className="font-medium text-slate-700 hover:text-brand-700 hover:underline">
                      {c.person.firstName} {c.person.lastName}
                    </Link>
                    {issues.length === 0 ? (
                      <span className="badge bg-emerald-100 text-emerald-800">cleared</span>
                    ) : (
                      <span className="badge bg-amber-100 text-amber-800">{issues.join(" · ")}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <p className="text-sm text-slate-500">
        {mediaOptOuts} {mediaOptOuts === 1 ? "person has" : "people have"} withheld media
        consent — honored against the person record on the public site and in team media.
      </p>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-3xl font-extrabold ${warn ? "text-amber-600" : "text-emerald-600"}`}>{value}</div>
    </div>
  );
}
function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mb-3 mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      {children}
    </div>
  );
}
function Ok({ text }: { text: string }) {
  return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{text}</p>;
}
