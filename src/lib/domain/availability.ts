// The 48-hour confirmation rule (§14). Each player marks Playing or Not playing
// in the system — player-entered, not relayed through a coach. A team that
// cannot field enough confirmed players by the 48-hour mark triggers an
// automatic alert to the coach, the Academy Director, and the COO, and risks a
// forfeit. The financial rationale: PURE reserves and pays for four courts for
// two hours per match night, so courts can be released while a facility can
// still resell them.

// A match fields the top three doubles pairings — six players minimum.
export const MIN_CONFIRMED_PLAYERS = 6;
export const CONFIRM_WINDOW_HOURS = 48;
export const NOTICE_DAYS = 7;

export type TeamConfirmation = {
  teamId: string;
  teamName: string;
  rosterSize: number;
  confirmedPlaying: number;
  confirmedNotPlaying: number;
  unconfirmed: number;
  enough: boolean;
};

export function hoursUntil(when: Date, now: Date): number {
  return (when.getTime() - now.getTime()) / (1000 * 60 * 60);
}

/** Is a fixture inside the 48-hour confirmation window (and not yet played)? */
export function inConfirmationWindow(scheduledAt: Date, now: Date): boolean {
  const h = hoursUntil(scheduledAt, now);
  return h <= CONFIRM_WINDOW_HOURS && h > -3; // small grace after start
}

export function teamConfirmation(
  teamId: string,
  teamName: string,
  rosterSize: number,
  statuses: string[]
): TeamConfirmation {
  const confirmedPlaying = statuses.filter((s) => s === "PLAYING").length;
  const confirmedNotPlaying = statuses.filter((s) => s === "NOT_PLAYING").length;
  const unconfirmed = rosterSize - confirmedPlaying - confirmedNotPlaying;
  return {
    teamId,
    teamName,
    rosterSize,
    confirmedPlaying,
    confirmedNotPlaying,
    unconfirmed,
    enough: confirmedPlaying >= MIN_CONFIRMED_PLAYERS,
  };
}

/**
 * Should an escalation alert fire? Inside the window, and a team is short of the
 * minimum confirmed players. The team is "at risk" of forfeit.
 */
export function shouldEscalate(
  scheduledAt: Date,
  now: Date,
  team: TeamConfirmation
): boolean {
  return inConfirmationWindow(scheduledAt, now) && !team.enough;
}
