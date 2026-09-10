import "server-only";
import { prisma } from "@/lib/db";
import { formatTime12 } from "@/lib/time";

// The signable PURE Coaching Agreement: the acknowledgment clauses (the part the
// coach actually agrees to) plus the fixed compensation terms, and a helper that
// pulls each coach's live assignment (teams, role, day/time, location) to
// auto-fill Appendix A. The full handbook lives at /console/handbook (PDF).

export const AGREEMENT_VERSION = "Fall 2026";

export const ACK_CLAUSES: { title: string; text: string }[] = [
  { title: "Handbook Compliance", text: "Coach acknowledges receiving and reviewing the PURE Coaching Handbook & Agreement and agrees to follow its safety, supervision, conduct, attendance, communication, emergency, and operational requirements, together with applicable PURE policies and lawful directives." },
  { title: "Eligibility to Coach", text: "Coach will not coach or supervise participants until all credentials required by PURE are current and approved, including the required SafeSport training, background screening, and CPR/AED/First Aid certification. Coach authorizes PURE to verify completion/status as permitted by law. PURE will pay the standard cost of the background screening it requires." },
  { title: "Minor-Athlete Safety", text: "Coach agrees to maintain professional boundaries; avoid private or hidden one-on-one interactions with minors; follow PURE's release, transportation, communication, photography/media, and reporting procedures; and immediately escalate safety concerns." },
  { title: "Scheduling and Coverage", text: "Coach agrees to report absences/tardiness promptly, assist with coverage when requested, and use only substitutes approved by PURE. Coach may not place an unapproved person in charge of a PURE session. For planned absences, Coach should request a substitute from the Academy Director at least two weeks in advance whenever reasonably possible." },
  { title: "Participant Information", text: "Coach will protect participant contact, medical, roster, and other confidential information and use it solely for authorized PURE purposes, and will not use that information or the coaching relationship to solicit participants for another program." },
  { title: "Incident and Misconduct Reporting", text: "Coach agrees to timely report injuries, emergencies, suspected abuse or misconduct, and other material safety incidents through the procedures required by PURE and applicable law. Internal reporting does not replace any legally required external report." },
  { title: "Sexual Harassment and Misconduct", text: "Coach acknowledges Section 12A of the handbook, agrees to its zero-tolerance standards for minors and adults, and will comply with immediate reporting, non-retaliation, cooperation, and protective-measure requirements. Violations may result in immediate termination, subject to applicable law." },
  { title: "PURE Property & Program Relationships", text: "Coach will protect PURE equipment and property, will not divert PURE participants or confidential participant information for unauthorized personal business, and will return PURE materials upon request. PURE curriculum and program materials remain PURE property. Coach consents to PURE using Coach's name, photograph, biography, and credentials in PURE materials and marketing, subject to applicable law." },
  { title: "Independent Contractor Relationship", text: "When Coach is engaged by PURE as an independent contractor, Coach is not an employee, partner, or agent of PURE and is responsible for applicable taxes. PURE will collect a Form W-9 and issue a Form 1099 when required. PURE establishes the curriculum, schedule, venue, program standards, and assigned responsibilities; Coach controls the manner of instruction within those requirements, subject to the safety and conduct standards in the handbook." },
  { title: "Corrective Action", text: "Failure to follow safety or conduct requirements may result in removal from a session, suspension, termination of the coaching relationship, or other action consistent with the Coach's applicable agreement and law. Confidentiality and PURE curriculum/property obligations survive the end of the coaching relationship." },
  { title: "Governing Law", text: "To the extent legally permitted and not superseded by another written agreement, this agreement is governed by the laws of the State of Arizona, with venue in Maricopa County, Arizona. Electronic signatures may be used and are treated as originals." },
];

export const COMP_TERMS: { item: string; term: string }[] = [
  { item: "Session rate", term: "$100 per session for a Coach; $50 per session for an Assistant Coach." },
  { item: "Season total", term: "$1,200 per team across twelve sessions for a Coach, paid evenly across the season. A Coach assigned two teams is paid $2,400." },
  { item: "Payment", term: "Monthly, in arrears, within 5 days after end of month." },
  { item: "PURE-cancelled sessions", term: "Where PURE cancels a session for weather, heat, or facility closure, Coach is paid for that session. Academy practices are not rescheduled; ACP league matches and the Championship may be rescheduled as directed by PURE/ACP." },
  { item: "Player-Coach season fee", term: "When Coach plays on the team they coach, the $495 season fee is waived for that team; session compensation is unchanged; and Coach registers as a player in the normal way." },
  { item: "À la carte programming", term: "60% of net revenue after court cost to Coach; 10% to Academy Director; 30% to PURE. PURE sets all prices and has final pricing authority." },
  { item: "Expenses", term: "PURE pays court fees and provides PURE apparel and program equipment. Coach provides their own transportation unless otherwise agreed in writing." },
];

export const SEASON_LINE = "September 14 – December 13, 2026. Twelve sessions per team: six practices, five ACP league matches, and the ACP Championship. Thanksgiving dark week: November 23–29.";

export type AssignmentTeam = { team: string; role: string; dayTime: string; location: string };
export type AgreementAssignment = { teams: AssignmentTeam[]; roleSummary: string };

/** Gather a coach's live assignment for Appendix A: each team they head or
 *  assist, with role, practice day/time, and facility. */
export async function coachAssignmentForAgreement(coachId: string): Promise<AgreementAssignment> {
  const teams = await prisma.team.findMany({
    where: { OR: [{ coachId }, { assistantCoaches: { some: { coachId } } }] },
    select: {
      name: true, dayOfWeek: true, startTime: true, coachId: true,
      market: true, divisionCode: true,
      facility: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
  const rows: AssignmentTeam[] = teams.map((t) => ({
    team: t.name,
    role: t.coachId === coachId ? "Coach" : "Assistant Coach",
    dayTime: t.dayOfWeek && t.startTime ? `${t.dayOfWeek} ${formatTime12(t.startTime)}` : "TBD",
    location: [t.facility?.name, t.divisionCode || t.market].filter(Boolean).join(" · ") || "TBD",
  }));
  const anyHead = rows.some((r) => r.role === "Coach");
  const anyAsst = rows.some((r) => r.role === "Assistant Coach");
  const roleSummary = anyHead && anyAsst ? "Coach / Assistant Coach" : anyAsst ? "Assistant Coach" : "Coach";
  return { teams: rows, roleSummary };
}
