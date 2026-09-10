// The standard PURE Academy season description (mirrors the copy on
// purepickleball.com) — shown on the signup pages so families see exactly what
// the season includes before they register.
const POINTS = [
  "6 weeks of team practices, team ladders, and competition preparation",
  "5 weeks of Arizona Club Pickleball league play",
  "Final week: Arizona Club Pickleball championship",
  "6 to 8 players per team; placement by age and skill level",
  "2-hour weekly coach-led practices and matches",
  "Youth teams: Elementary, Middle, High School age groups",
  "Adult teams: Men's and Women's 2.5 through 5.0+",
  "Scottsdale, Paradise Valley, Phoenix, Tempe, Chandler, Gilbert, or Mesa",
];

export function SeasonOverview({ className = "" }: { className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-600">The season</h2>
      <p className="mt-1 text-lg font-bold text-slate-900">
        12-week season: September 14–December 13 <span className="font-medium text-slate-500">(off Thanksgiving week)</span>
      </p>
      <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {POINTS.map((p) => (
          <li key={p} className="flex items-start gap-2 text-sm text-slate-600">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
