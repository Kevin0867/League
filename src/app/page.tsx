import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { prisma } from "@/lib/db";

export default async function HomePage() {
  const season = await prisma.season
    .findFirst({ where: { active: true, program: "PURE_ACADEMY" }, orderBy: { startDate: "desc" } })
    .catch(() => null);

  return (
    <div>
      <PublicNav />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 text-white">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <p className="mb-3 inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            {season ? season.name : "Fall 2026 Season"}
          </p>
          <h1 className="max-w-2xl text-4xl font-extrabold leading-tight sm:text-5xl">
            Youth &amp; adult pickleball, organized end to end.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-brand-50">
            Register, get placed on a team, and play a DUPR-recorded league —
            all in one place. Coaches manage rosters, attendance, and match
            nights from their phone.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className="btn bg-white text-brand-700 hover:bg-brand-50">
              Register for the season
            </Link>
            <Link href="/standings" className="btn bg-brand-500/40 text-white ring-1 ring-white/40 hover:bg-brand-500/60">
              View league standings
            </Link>
          </div>
          <p className="mt-6 text-sm text-brand-100">
            Enroll today, pay later — payment is requested only after you&apos;re
            placed on a team, coach, location, day, and time.
          </p>
        </div>
      </section>

      {/* Capability grid */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold text-slate-900">Everything a season needs</h2>
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

      {/* ACP league strip */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              Arizona Club Pickleball — a DUPR-recorded league
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
                <div className="text-3xl font-extrabold text-brand-700">{s.value}</div>
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
