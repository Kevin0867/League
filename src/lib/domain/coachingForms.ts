// The "Reusable Forms" from the Coaches Workbook, as digital forms. Each is a
// subsection under the Coaching Handbook. The trackers write quantifiable
// PlayerProgressEntry rows so progress can be analyzed over time.

export const PROGRESS_WEEKS = 6;

export type ReusableForm = { slug: string; title: string; desc: string; built: boolean };

export const REUSABLE_FORMS: ReusableForm[] = [
  { slug: "serve-return", title: "Serve & Return Progress Tracker", desc: "Weekly serve % and return % for each player.", built: true },
  { slug: "kitchen-arrival", title: "Kitchen Arrival Tracker", desc: "How often each player/pair gets to the kitchen line, by week.", built: false },
  { slug: "ladder", title: "Weekly Ladder & Challenge Match Tracker", desc: "Wins, losses, points, and rank from ladder & challenge matches.", built: false },
  { slug: "development", title: "Player Development Tracker", desc: "Skill ratings across serve/return, 3rd shot, transition, kitchen, strategy, competition, partnership.", built: false },
  { slug: "lineup", title: "League Lineup Worksheet", desc: "Set lines 1–4 with pairings and matchup notes.", built: false },
  { slug: "match-plan", title: "Team Match Plan", desc: "Serving/return targets, opponent weakness, transition & kitchen strategy.", built: false },
  { slug: "scouting", title: "Match-Day Scouting Sheet", desc: "Opponent observations, game plan, and after-match notes.", built: false },
  { slug: "homework", title: "Player Homework & Accountability Log", desc: "Weekly assignments, completion, and player takeaways.", built: false },
];

// Metric keys for the Serve & Return tracker (each week has both).
export const SR_SERVE = "SERVE";
export const SR_RETURN = "RETURN";
export const SR_NOTE = "SR_NOTE"; // per-player note (week 0)
