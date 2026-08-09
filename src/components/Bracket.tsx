import { recordChampResult } from "@/app/console/championship/actions";

export type BracketMatch = {
  id: string;
  round: number;
  slot: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeSeed: number | null;
  awaySeed: number | null;
  winnerTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
};

function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

export function Bracket({
  matches,
  teamNames,
  editable = false,
}: {
  matches: BracketMatch[];
  teamNames: Record<string, string>;
  editable?: boolean;
}) {
  if (matches.length === 0) {
    return <p className="text-sm text-slate-400">No bracket drawn yet.</p>;
  }
  const rounds = Math.max(...matches.map((m) => m.round));
  const byRound: Record<number, BracketMatch[]> = {};
  for (const m of matches) (byRound[m.round] ??= []).push(m);
  for (const r of Object.keys(byRound)) byRound[+r].sort((a, b) => a.slot - b.slot);

  return (
    <div className="flex gap-6 overflow-x-auto pb-2">
      {Array.from({ length: rounds }, (_, i) => i + 1).map((round) => (
        <div key={round} className="min-w-[220px] flex-1">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {roundLabel(round, rounds)}
          </h3>
          <div className="flex h-full flex-col justify-around gap-3">
            {(byRound[round] ?? []).map((m) => (
              <MatchCard key={m.id} m={m} teamNames={teamNames} editable={editable} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TeamRow({
  teamId, seed, score, isWinner, teamNames,
}: { teamId: string | null; seed: number | null; score: number | null; isWinner: boolean; teamNames: Record<string, string> }) {
  return (
    <div className={`flex items-center justify-between rounded px-2 py-1 text-sm ${isWinner ? "bg-emerald-50 font-semibold text-emerald-800" : "text-slate-700"}`}>
      <span className="truncate">
        {seed ? <span className="mr-1 text-xs text-slate-400">#{seed}</span> : null}
        {teamId ? teamNames[teamId] ?? "Unknown" : <span className="text-slate-400">TBD</span>}
      </span>
      {score !== null && <span className="ml-2 tabular-nums text-slate-500">{score}</span>}
    </div>
  );
}

function MatchCard({ m, teamNames, editable }: { m: BracketMatch; teamNames: Record<string, string>; editable: boolean }) {
  const canRecord = editable && m.status === "READY" && m.homeTeamId && m.awayTeamId;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      <TeamRow teamId={m.homeTeamId} seed={m.homeSeed} score={m.homeScore} isWinner={m.winnerTeamId === m.homeTeamId && !!m.winnerTeamId} teamNames={teamNames} />
      <div className="my-1 border-t border-dashed border-slate-100" />
      <TeamRow teamId={m.awayTeamId} seed={m.awaySeed} score={m.awayScore} isWinner={m.winnerTeamId === m.awayTeamId && !!m.winnerTeamId} teamNames={teamNames} />

      {m.status === "BYE" && <div className="mt-1 text-center text-[11px] text-slate-400">bye — advances</div>}

      {canRecord && (
        <form action={recordChampResult} className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          <input type="hidden" name="matchId" value={m.id} />
          <div className="flex items-center gap-1">
            <input name="homeScore" type="number" min={0} placeholder="H" className="input px-1 py-0.5 text-center text-xs" />
            <span className="text-slate-300">–</span>
            <input name="awayScore" type="number" min={0} placeholder="A" className="input px-1 py-0.5 text-center text-xs" />
          </div>
          <div className="flex gap-1">
            <button name="winnerTeamId" value={m.homeTeamId!} className="flex-1 rounded bg-slate-100 px-1 py-1 text-[11px] font-medium text-slate-700 hover:bg-emerald-100">
              {teamNames[m.homeTeamId!]} wins
            </button>
            <button name="winnerTeamId" value={m.awayTeamId!} className="flex-1 rounded bg-slate-100 px-1 py-1 text-[11px] font-medium text-slate-700 hover:bg-emerald-100">
              {teamNames[m.awayTeamId!]} wins
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
