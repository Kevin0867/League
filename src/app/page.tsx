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

      {/* Hero — mirrors the PURE Academy marketing page */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-brand-950 text-white">
        {/* subtle accent glow */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-500/20 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-24">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            {/* Left — headline, ethos quote, attribution */}
            <div>
              <p className="eyebrow eyebrow-light mb-5">PURE Academy</p>
              <h1 className="display text-4xl text-white sm:text-5xl">
                Arizona&apos;s Premier{" "}
                <em className="text-accent-400">Player Development Academy</em>
              </h1>
              <blockquote className="mt-6 max-w-xl text-lg italic text-brand-100">
                &ldquo;We believe team training accelerates player development. Players train,
                compete, and improve together.&rdquo;
              </blockquote>
              <p className="mt-3 text-sm text-brand-200">
                <span className="font-semibold text-white">Stephanie Newton</span>, Director &amp; Head Coach, PURE Academy ELITE TEAMS
              </p>
            </div>

            {/* Right — Elite Team image */}
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/pure-academy-elite.png"
                alt="PURE Academy ELITE Team"
                className="w-full rounded-2xl shadow-2xl ring-1 ring-white/10"
              />
            </div>
          </div>

          {/* CTA + program details */}
          <div className="mt-10 grid gap-8 lg:grid-cols-2 lg:items-start">
            <div>
              <Link
                href="/register"
                className="btn-accent inline-flex flex-col items-center rounded-2xl px-8 py-5 text-center"
              >
                <span className="text-base font-extrabold uppercase tracking-wide">Fall 2026 Season — Now Enrolling</span>
                <span className="mt-0.5 text-xs font-medium uppercase tracking-wide text-brand-900/70">All ages &amp; skill levels</span>
              </Link>
            </div>

            <div>
              <p className="eyebrow eyebrow-light mb-3">$495 per player · enroll today, pay later</p>
              <ul className="space-y-2 text-sm text-brand-100">
                {[
                  "12-week season: September 14–December 13 (off Thanksgiving week)",
                  "6 weeks of team practices, team ladders, and competition preparation",
                  "5 weeks of Arizona Club Pickleball league play",
                  "Final week: Arizona Club Pickleball championship",
                  "6 to 8 players per team; placement by age and skill level",
                  "2-hour weekly coach-led practices and matches",
                  "Youth teams: Elementary, Middle, High School age groups",
                  "Adult teams: Men's and Women's 2.5, 3.0, 3.5, 4.0, and 4.5+",
                  "Scottsdale, Chandler, Gilbert, Mesa, Phoenix, or Tempe",
                ].map((line) => (
                  <li key={line} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* What the season includes */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <p className="eyebrow">The season</p>
        <h2 className="display mt-3 text-3xl text-brand-900 sm:text-4xl">
          Everything the season <em className="text-accent-600">includes</em>
        </h2>
        <p className="mt-2 text-slate-600">From your first practice to championship week.</p>
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
              <div key={s.label} className="card flex min-h-[7.5rem] flex-col items-center justify-center text-center">
                <div className="text-4xl font-extrabold leading-none text-accent-600 tabular-nums">{s.value}</div>
                <div className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">
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
  { icon: "📝", title: "Simple enrollment", body: "Enroll each player once — waiver, skill level, and emergency contacts, all in one place." },
  { icon: "🧩", title: "Team placement", body: "Pick one division; the Director places you on the right team by age and skill after Week 1." },
  { icon: "📅", title: "A full season", body: "A twelve-session season: six practice weeks, five league weeks, and championship week." },
  { icon: "🏆", title: "League & championship", body: "Line-by-line scoring, live standings, and a championship bracket — every game DUPR-recorded." },
  { icon: "💳", title: "Enroll today, flexible payments", body: "$495 per player. Secure checkout — pay in full, or in 3 payments (today, +30 and +60 days)." },
  { icon: "💬", title: "Stay in the loop", body: "Team, coach, and league updates in-app and by email, with texts for time-critical alerts." },
];

const STATS = [
  { value: "12", label: "Session season" },
  { value: "5", label: "League weeks" },
  { value: "48hr", label: "DUPR submission" },
  { value: "$495", label: "Season fee" },
];
