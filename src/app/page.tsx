import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { listPublicClinics, formatClinicWhen } from "@/lib/domain/clinics";

export default async function HomePage() {
  const season = await prisma.season
    .findFirst({ where: { active: true, program: "PURE_ACADEMY" }, orderBy: { startDate: "desc" } })
    .catch(() => null);
  const clinics = (await listPublicClinics().catch(() => [])).slice(0, 3);

  return (
    <div>
      <PublicNav />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-brand-950 text-white">
        {/* subtle accent glow */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-500/20 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 py-24">
          <p className="eyebrow eyebrow-light mb-5">
            {season ? season.name : "PURE Academy · Fall 2026"}
          </p>
          <h1 className="display max-w-3xl text-4xl text-white sm:text-6xl">
            Youth &amp; adult pickleball,{" "}
            <em className="text-accent-400">organized end to end.</em>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-brand-100">
            Register, get placed on a team, and play a DUPR-recorded league —
            all in one place. Coaches manage rosters, attendance, and match
            nights from their phone.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className="btn-accent px-6 py-3 text-base">
              Register for the season
            </Link>
            <Link href="/standings" className="btn bg-white/10 px-6 py-3 text-base text-white ring-1 ring-white/25 hover:bg-white/20">
              View league standings
            </Link>
          </div>
          <p className="mt-6 text-sm text-brand-300">
            Enroll today, pay later — payment is requested only after you&apos;re
            placed on a team, coach, location, day, and time.
          </p>
        </div>
      </section>

      {/* Capability grid */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <p className="eyebrow">The platform</p>
        <h2 className="display mt-3 text-3xl text-brand-900 sm:text-4xl">
          Everything a season <em className="text-accent-600">needs</em>
        </h2>
        <p className="mt-2 text-slate-600">One platform across the whole operation.</p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CAPS.map((c) => (
            <div key={c.title} className="card">
              <div className="text-2xl">{c.icon}</div>
              <h3 className="mt-2 font-semibold text-slate-900">{c.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Active clinics */}
      {clinics.length > 0 && (
        <section className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="eyebrow">Drop in</p>
                <h2 className="display mt-3 text-3xl text-brand-900 sm:text-4xl">
                  Upcoming <em className="text-accent-600">clinics</em>
                </h2>
                <p className="mt-2 text-slate-600">Reserve a spot with a PURE coach — pay online, no account needed.</p>
              </div>
              <Link href="/clinics" className="btn-secondary">See all clinics</Link>
            </div>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {clinics.map((c) => (
                <div key={c.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-bold text-slate-900">{c.title}</h3>
                    <span className="whitespace-nowrap rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-700">{formatCents(c.priceCents)}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-600">{formatClinicWhen(c.scheduledAt)}</p>
                  <p className="text-sm text-slate-500">{c.facilityName}{c.coachName ? ` · Coach ${c.coachName}` : ""}</p>
                  <div className="mt-4 flex items-center justify-between gap-3 pt-2">
                    <span className={`text-sm font-medium ${c.isFull ? "text-rose-600" : "text-emerald-700"}`}>
                      {c.isFull ? "Full" : `${c.spotsLeft} spots left`}
                    </span>
                    {c.isFull
                      ? <span className="text-sm font-semibold text-slate-400">Sold out</span>
                      : <Link href={`/clinics/${c.id}`} className="btn-accent px-4 py-2 text-sm">Sign up</Link>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ACP league strip */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 md:grid-cols-2">
          <div>
            <p className="eyebrow mb-3">The league</p>
            <h2 className="display text-3xl text-brand-900 sm:text-4xl">
              Arizona Club Pickleball —{" "}
              <em className="text-accent-600">a DUPR-recorded league</em>
            </h2>
            <p className="mt-3 text-slate-600">
              Doubles-only, three ranked lines per match, best of three to 11.
              Every game is recorded and submitted to DUPR within 48 hours of
              match night — the rating benefit players are actually promised.
            </p>
            <p className="mt-3 text-slate-600">
              Open to outside clubs too, not just PURE Academy teams. A verified
              DUPR account is required before a player&apos;s first league match.
            </p>
            <Link href="/programs" className="btn-secondary mt-5">Learn about divisions</Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {STATS.map((s) => (
              <div key={s.label} className="card text-center">
                <div className="text-3xl font-extrabold text-accent-600">{s.value}</div>
                <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-10 text-sm text-slate-500">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span>© {new Date().getFullYear()} PURE Academy · Arizona Club Pickleball</span>
          <div className="flex gap-5">
            <Link href="/programs" className="hover:text-brand-700">Programs</Link>
            <Link href="/locations" className="hover:text-brand-700">Locations</Link>
            <Link href="/login" className="hover:text-brand-700">Member login</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

const CAPS = [
  { icon: "📝", title: "Registration & records", body: "One profile per person — player, parent, or coach — with waivers, DUPR, and emergency contacts." },
  { icon: "🧩", title: "Team placement", body: "Pool-and-assign by division, location, and time. You pick one division; the Director places you after Week 1." },
  { icon: "📅", title: "Scheduling", body: "A twelve-session season per team: six practice weeks, five league weeks, and championship week." },
  { icon: "🏆", title: "League & championship", body: "Line-by-line scoring, standings, seedings, and a championship bracket — all DUPR-recorded." },
  { icon: "💳", title: "Payments", body: "Secure hosted checkout. Pay in full or monthly. We never store card details." },
  { icon: "💬", title: "Communications", body: "Team, coach, and league messages in-app, mirrored to email, with SMS for time-critical alerts." },
];

const STATS = [
  { value: "12", label: "Session season" },
  { value: "5", label: "League weeks" },
  { value: "48hr", label: "DUPR submission" },
  { value: "$495", label: "Season fee" },
];
