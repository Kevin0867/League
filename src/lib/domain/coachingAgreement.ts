import "server-only";
import { prisma } from "@/lib/db";
import { formatTime12 } from "@/lib/time";

// The signable PURE Coaching Agreement: the acknowledgment clauses (the part the
// coach actually agrees to) plus the fixed compensation terms, and a helper that
// pulls each coach's live assignment (teams, role, day/time, location) to
// auto-fill Appendix A. The full handbook lives at /console/handbook (PDF).

export const AGREEMENT_VERSION = "Fall 2026";

// The FULL handbook body, rendered inline on the signature page so a coach
// cannot sign without the entire agreement in front of them.
export const AGREEMENT_BODY: { title: string; paras: string[] }[] = [
  { title: "Purpose", paras: [
    "This agreement establishes minimum coaching, safety, supervision, communication, and professional-conduct standards for coaches working with PURE Pickleball & Padel — Scottsdale. Coaches are expected to know and follow these standards at every session, event, camp, clinic, league, lesson, and other PURE activity. Effective: September 2026.",
  ] },
  { title: "1. Coach Eligibility, Screening & Required Certifications", paras: [
    "No coach may begin coaching, supervising minors, or representing PURE until all required onboarding items are complete and approved by PURE.",
    "SafeSport: Coaches who work with minors must complete the SafeSport training designated by PURE before beginning work and keep required training/refresher status current.",
    "Background check: Every coach age 18 or older must successfully complete the background screening designated by PURE before coaching. PURE will pay the standard cost of the required background check.",
    "CPR/AED and First Aid: Coaches must maintain current certification from a provider accepted by PURE and provide documentation upon request.",
    "Coaches must promptly disclose any lapse, suspension, restriction, investigation, criminal charge, or other circumstance that may affect eligibility to coach or safely supervise participants, subject to applicable law. No clearance = no coaching.",
  ] },
  { title: "2. Scheduling, Call-Outs & Substitute Coaches", paras: [
    "Coaches arrive at least 15 minutes before the scheduled start unless the Program Director sets a different reporting time.",
    "If a coach cannot work a session, notify the Program Director or scheduling contact as soon as coverage is needed — at least 24 hours in advance except for emergencies. A coach must not cancel a session directly with families or independently select an outside substitute unless authorized by PURE.",
    "The coach assists in locating coverage from PURE's approved list, but final approval and assignment of the substitute belongs to PURE. Substitutes must satisfy the same SafeSport, background-check, certification, and onboarding requirements. Repeated tardiness, late call-outs, no-shows, or unauthorized substitutions may result in removal from the schedule.",
  ] },
  { title: "3. Student Roster, Health Information & Confidentiality", paras: [
    "Maintain access to the current roster, including each participant's name and at least two emergency contacts when supplied. Review medical alerts, allergies, physical limitations, and parent-provided instructions before the session.",
    "Treat participant medical and contact information as confidential — do not photograph, copy, download, forward, or use it for any non-PURE purpose. Follow PURE's medication policy; medication stays in original/labeled packaging and is handled only as authorized. Report conflicting or concerning medical instructions to the Program Director before the participant takes part when practicable.",
  ] },
  { title: "4. Arrival, Early Drop-Off & Attendance", paras: [
    "Take attendance at the start of every session in the designated system. PURE supervision begins only at the stated check-in time; a child who arrives earlier remains the parent/guardian's responsibility unless PURE staff has affirmatively accepted supervision.",
    "Do not allow an early-arriving child to remain alone in any unsupervised location. Follow the designated absence procedure, and never leave the assigned group unattended to look for a missing participant — request another authorized staff member.",
  ] },
  { title: "5. Supervision & Minor-Athlete Safety", paras: [
    "All interactions with minors must remain professional and consistent with PURE's child-safety standards. One-on-one interactions with a minor should be observable and interruptible; avoid being alone with a single minor in a closed or isolated area except in an unavoidable emergency.",
    "Maintain a two-adult or group environment during transitions, individual instruction, early arrival, and late pickup whenever possible. No sexual, romantic, hazing, bullying, harassing, humiliating, retaliatory, or grooming behavior is permitted. Physical contact is limited to what is reasonably necessary for safe, age-appropriate coaching. Do not enter a restroom, locker room, or changing area with a minor except as permitted by PURE policy for a genuine safety need.",
  ] },
  { title: "6. Communications, Phones, Photos & Social Media", paras: [
    "Use PURE-approved channels for program communication. Electronic communication with a minor must be open and transparent — include the parent/guardian or another authorized adult. No disappearing-message communications, secret/private chats, flirting, or late-night personal messaging with a minor.",
    "Do not post, tag, livestream, or distribute identifiable images/video of a minor unless covered by PURE's media authorization and approved for the use. Never use a participant's phone, account, password, or device except in a genuine emergency.",
  ] },
  { title: "7. Pickup, Authorized Release & Late Pickup", paras: [
    "Youth participants are released only to a parent/guardian or adult authorized under PURE's procedures; follow any pickup code/ID system consistently and do not release when authorization is unclear.",
    "Late pickup: at 5 minutes call the parent; at 10 minutes attempt secondary/emergency contacts and notify the Program Director; at 15 minutes move to a public, observable area with another adult present; at 30 minutes the manager/Program Director determines escalation. Coaches must not take a minor home or transport a minor in a personal vehicle merely because a parent is late.",
  ] },
  { title: "8. Transportation & Off-Site Activities", paras: [
    "Coaches may not transport a minor in a personal vehicle unless specifically authorized under PURE's written procedures with any required consent. Avoid one-on-one transportation of a minor, and do not arrange rideshares/taxis for a minor on a parent's behalf unless an authorized procedure permits it.",
  ] },
  { title: "9. Professional Coaching Standards", paras: [
    "Be prepared, punctual, attentive, and engaged. Use age-appropriate, positive instruction — no profanity directed at participants, degrading language, threats, corporal punishment, or conditioning used as punishment. Maintain appropriate boundaries with participants and families.",
    "Do not coach while impaired. Wear PURE-approved attire and follow facility standards. Do not accept private payment for PURE programming, divert PURE participants to unauthorized private lessons, or use participant information for personal business without written authorization.",
  ] },
  { title: "10. Participant Behavior & Discipline", paras: [
    "Set clear expectations and use progressive, age-appropriate responses: redirection, brief reset, individual discussion in an observable setting, and escalation to the Program Director/parent when needed. A coach may immediately remove a participant from play when conduct creates an immediate safety risk, keeping them supervised until released to an authorized adult. Do not diagnose a child or promise confidentiality when a safety concern may require reporting.",
  ] },
  { title: "11. Emergency Response, Injury & Incident Reporting", paras: [
    "Know each facility's emergency action plan, address, AED and first-aid locations, and how to reach the manager on duty. For a serious or life-threatening emergency, call 911 immediately. Provide care only within your training and certification.",
    "Remain with the participant until responsibility transfers to EMS, a parent/guardian, or another authorized person. Complete PURE's incident/injury report before leaving when feasible and no later than 24 hours after the event. Report hazards promptly and stop or relocate activity when unsafe.",
  ] },
  { title: "12. Reporting Safety, Abuse or Misconduct Concerns", paras: [
    "Immediately report suspected abuse, neglect, sexual misconduct, grooming, threats, or other serious child-safety concerns through the channels required by law and PURE policy. Do not investigate, confront an accused person, pressure a child, or promise secrecy. Notify the Program Director or safeguarding contact as soon as possible unless that would interfere with emergency or legally required reporting. Retaliation for a good-faith report is prohibited.",
  ] },
  { title: "12A. Zero Tolerance for Sexual Harassment and Sexual Misconduct", paras: [
    "PURE prohibits sexual harassment, sexual misconduct, and retaliation by every coach — including substitutes and contractors — in interactions with minors, adults, participants, families, and colleagues, in person and electronically.",
    "Coaches must never pursue or engage in sexual or romantic conduct with a minor participant, regardless of claimed consent or parental approval, and must not exploit authority, trust, or dependency with any participant. PURE prohibits sexual/romantic relationships with an adult participant while the coach holds coaching, supervisory, evaluative, or selection authority.",
    "Immediately report observed, disclosed, or suspected sexual harassment, misconduct, grooming, or retaliation to the Program Director or safeguarding contact; if that person is implicated or unavailable, report to an uninvolved PURE owner or senior manager. Anyone may bypass the usual chain. Internal notice never replaces required reports to law enforcement, child-protection authorities, or the U.S. Center for SafeSport where applicable, including Arizona law. Violations may result in immediate termination, subject to applicable law.",
  ] },
  { title: "13. Session-Ready & Equipment", paras: [
    "Arrive early and check in; confirm the court/space is safe; have the roster, attendance method, emergency contacts and medical alerts, first-aid kit and AED location, and appropriate equipment (paddles, balls, nets, caddy, teaching aids). Return equipment to secured storage and report anything missing, damaged, or unsafe.",
  ] },
  { title: "14. Administration, Policy Changes & Questions", paras: [
    "This agreement sets minimum standards and may be supplemented by program procedures, facility rules, contractor policies, and applicable law. When rules conflict, stop and ask the Program Director unless immediate action is needed for safety. PURE may revise the handbook; coaches review updates and sign a new acknowledgment when requested.",
  ] },
];

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

// Credentials the coach enters when signing; an admin verifies these before
// countersigning. If any are wrong, the admin returns the agreement for
// correction and the coach re-does it.
export type AgreementCredentials = {
  safeSportCompleted?: string;
  safeSportExpires?: string;
  backgroundProvider?: string;
  backgroundCompleted?: string;
  cprProvider?: string;
  cprExpires?: string;
};

export const CREDENTIAL_FIELDS: {
  key: keyof AgreementCredentials;
  label: string;
  type: "date" | "text";
  required?: boolean;
  placeholder?: string;
}[] = [
  { key: "safeSportCompleted", label: "SafeSport — completion date", type: "date", required: true },
  { key: "safeSportExpires", label: "SafeSport — expiration date", type: "date" },
  { key: "backgroundProvider", label: "Background check — provider/agency", type: "text", required: true, placeholder: "e.g. NCSI, Sterling" },
  { key: "backgroundCompleted", label: "Background check — completion date", type: "date", required: true },
  { key: "cprProvider", label: "CPR / AED / First Aid — provider (not required)", type: "text", placeholder: "e.g. American Red Cross, or N/A" },
  { key: "cprExpires", label: "CPR / AED / First Aid — expiration (not required)", type: "text", placeholder: "MM/DD/YYYY, or N/A" },
];

export function credentialLabel(key: keyof AgreementCredentials): string {
  return CREDENTIAL_FIELDS.find((f) => f.key === key)?.label ?? key;
}

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
