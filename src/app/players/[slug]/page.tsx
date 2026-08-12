import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { getPlayerProfile } from "@/lib/domain/playerHistory";
import { personIdFromPlayerSlug } from "@/lib/domain/publicPlayer";
import { formatDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await getPlayerProfile(personIdFromPlayerSlug(slug));
  if (!p) return { title: { absolute: "Player — PURE Academy" } };
  return {
    title: { absolute: `${p.displayName} — PURE Academy` },
    description: `${p.displayName}${p.teamShort ? `, ${p.teamShort}` : ""} — season record and match history.`,
    alternates: { canonical: `/players/${p.slug}` },
  };
}

export default async function PlayerProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getPlayerProfile(personIdFromPlayerSlug(slug));
  if (!p) notFound();

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="eyebrow">Player</p>
        <h1 className="display mt-2 text-3xl text-brand-900 sm:text-4xl">{p.displayName}</h1>

        {/* Team · coach · line */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
          {p.teamSlug && p.teamName && (
            <Link href={`/teams/${p.teamSlug}`} className="font-medium text-brand-700 hover:underline">{p.teamName}</Link>
          )}
          {(p.market || p.divisionCode) && (
            <span className="text-slate-400">{[p.market, p.divisionCode].filter(Boolean).join(" · ")}</span>
          )}
          {p.coachName && p.coachPersonId && (
            <span>
              Coach{" "}
              <Link href={`/coaches/${p.coachPersonId}`} className="font-medium text-brand-700 hover:underline">{p.coachName}</Link>
            </span>
          )}
        </div>

        {/* Quick facts */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Doubles line">
            {p.currentLine ? `#${p.currentLine}` : <span className="text-sm font-medium text-slate-400">Line assigned in Week 7</span>}
          </Fact>
          <Fact label="Lines played">{p.linesPlayed}</Fact>
          <Fact label="Record">{p.linesWon}–{p.linesLost}</Fact>
          {p.dupr != null ? (
            <Fact label="DUPR (doubles)">{p.dupr.toFixed(3)}</Fact>
          ) : (
            <Fact label="Games">{p.gamesWon}–{p.gamesLost}</Fact>
          )}
        </div>
        {p.dupr != null && (
          <p className="mt-2 text-xs text-slate-400">Doubles rating updates as league results are submitted to DUPR.</p>
        )}

        {/* Match history */}
        <section className="mt-10">
          <h2 className="font-semibold text-slate-900">Match history</h2>
          <p className="mt-0.5 text-sm text-slate-500">Every line played this season, with partner and opponents.</p>
          {p.matches.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
              No lines played yet — league play begins in Week 7.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {p.matches.map((m) => (
                <div key={`${m.fixtureId}-${m.lineNumber}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="badge bg-slate-100 text-slate-600">Line {m.lineNumber}{m.isExhibition ? " · exhibition" : ""}</span>
                      <span className="text-slate-400">{formatDate(m.date)}</span>
                    </div>
                    <ResultBadge result={m.result} exhibition={m.isExhibition} />
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    {m.partnerName && <>with <span className="font-medium">{m.partnerName}</span> · </>}
                    vs{" "}
                    {m.opponentSlug ? (
                      <Link href={`/teams/${m.opponentSlug}`} className="font-medium text-brand-700 hover:underline">{m.opponentName}</Link>
                    ) : (
                      <span className="font-medium">{m.opponentName}</span>
                    )}
                    {m.opponentPair && <span className="text-slate-500"> ({m.opponentPair})</span>}
                  </div>
                  {m.games.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.games.map((g, i) => (
                        <span key={i} className={`rounded-md px-2 py-1 text-sm font-semibold tabular-nums ${g.playerScore > g.opponentScore ? "bg-emerald-50 text-emerald-700" : g.playerScore < g.opponentScore ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-600"}`}>
                          {g.playerScore}–{g.opponentScore}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {p.matches.some((m) => m.isExhibition) && (
            <p className="mt-3 text-xs text-slate-400">Exhibition (line 4) results are shown but don&apos;t count toward the team result.</p>
          )}
        </section>

        <p className="mt-10 text-xs text-slate-400">
          Team standings carry the competition; a player&apos;s page shows what they played and who they played it with — there is no individual ranking.
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-extrabold text-slate-900 tabular-nums">{children}</div>
    </div>
  );
}

function ResultBadge({ result, exhibition }: { result: "won" | "lost" | "pending"; exhibition: boolean }) {
  if (result === "pending") return <span className="badge bg-slate-100 text-slate-500">Scheduled</span>;
  const label = result === "won" ? "Won" : "Lost";
  const cls = result === "won" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-700";
  return <span className={`badge ${cls}`}>{label}{exhibition ? " (exh.)" : ""}</span>;
}
