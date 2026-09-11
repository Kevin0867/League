// The "Reusable Forms" from the Coaches Workbook, as digital forms. Each is a
// subsection under the Coaching Handbook. The trackers write quantifiable
// PlayerProgressEntry rows so progress can be analyzed over time.

export const PROGRESS_WEEKS = 6;

export type ReusableForm = { slug: string; title: string; desc: string; built: boolean };

export const REUSABLE_FORMS: ReusableForm[] = [
  { slug: "serve-return", title: "Serve & Return Progress Tracker", desc: "Weekly serve % and return % for each player.", built: true },
  { slug: "development", title: "Player Development Tracker", desc: "Skill ratings across serve/return, 3rd shot, transition, kitchen, strategy, competition, partnership.", built: true },
  { slug: "kitchen-arrival", title: "Kitchen Arrival Tracker", desc: "How often each player/pair gets to the kitchen line, by week.", built: true },
  { slug: "ladder", title: "Weekly Ladder & Challenge Match Tracker", desc: "Wins, losses, points, and rank from ladder & challenge matches.", built: true },
  { slug: "lineup", title: "League Lineup Worksheet", desc: "Set lines 1–4 with pairings and matchup notes.", built: false },
  { slug: "match-plan", title: "Team Match Plan", desc: "Serving/return targets, opponent weakness, transition & kitchen strategy.", built: false },
  { slug: "scouting", title: "Match-Day Scouting Sheet", desc: "Opponent observations, game plan, and after-match notes.", built: false },
  { slug: "homework", title: "Player Homework & Accountability Log", desc: "Weekly assignments, completion, and player takeaways.", built: false },
];

// Metric keys for the Serve & Return tracker (each week has both).
export const SR_SERVE = "SERVE";
export const SR_RETURN = "RETURN";
export const SR_NOTE = "SR_NOTE"; // per-player note (week 0)

// Player Development Tracker — a current-snapshot rating per skill (week 0).
export const DEV_CATEGORIES: { key: string; label: string }[] = [
  { key: "DEV_SERVE_RETURN", label: "Serve / Return" },
  { key: "DEV_3RD_SHOT", label: "3rd Shot" },
  { key: "DEV_TRANSITION", label: "Transition" },
  { key: "DEV_KITCHEN", label: "Kitchen" },
  { key: "DEV_STRATEGY", label: "Strategy" },
  { key: "DEV_COMPETITION", label: "Competition" },
  { key: "DEV_PARTNERSHIP", label: "Partnership" },
];
export const DEV_RATINGS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "1", label: "Needs work" },
  { value: "2", label: "Improving" },
  { value: "3", label: "Strength" },
];
export const DEV_NOTE = "DEV_NOTE";

// Kitchen Arrival Tracker — a weekly count/percentage of how often each player
// gets established at the kitchen line. One number per week (weeks 1–6) + note.
export const KA_METRIC = "KITCHEN_ARRIVAL";
export const KA_NOTE = "KA_NOTE";

// Weekly Ladder & Challenge Match Tracker — per-player standings snapshot
// (week 0). Wins/losses/points-for/points-against/rank are quantifiable; a note
// captures challenge-match observations.
export const LADDER_COLUMNS: { key: string; label: string; int?: boolean }[] = [
  { key: "LADDER_WINS", label: "Wins", int: true },
  { key: "LADDER_LOSSES", label: "Losses", int: true },
  { key: "LADDER_PF", label: "Pts For", int: true },
  { key: "LADDER_PA", label: "Pts Against", int: true },
  { key: "LADDER_RANK", label: "Rank", int: true },
];
export const LADDER_NOTE = "LADDER_NOTE";
