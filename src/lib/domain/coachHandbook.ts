// PURE Coaching Handbook & Agreement content, transcribed from the source
// document so it renders as a fast, mobile-friendly page (no PDF/docx download
// needed). Structured as sections; a section is a heading plus blocks, where a
// block is a paragraph, a bullet, or a checkbox line.

export type HandbookBlock = { kind: "p" | "bullet" | "check"; text: string };
export type HandbookSection = { title: string; blocks: HandbookBlock[] };

const p = (text: string): HandbookBlock => ({ kind: "p", text });
const b = (text: string): HandbookBlock => ({ kind: "bullet", text });
const c = (text: string): HandbookBlock => ({ kind: "check", text });

export const HANDBOOK_META = {
  org: "PURE Pickleball & Padel — Scottsdale",
  title: "Coaching Handbook & Agreement",
  subtitle: "Youth, Adult & Academy Programs",
  effective: "Effective: September 2026",
};

export const HANDBOOK: HandbookSection[] = [
  {
    title: "Purpose",
    blocks: [
      p("This handbook establishes minimum coaching, safety, supervision, communication, and professional-conduct standards for coaches working with PURE programs. Coaches are expected to know and follow these standards at every session, event, camp, clinic, league, lesson, and other PURE activity."),
      p("Effective: September 2026. The final section includes the Coach Acknowledgment & Agreement."),
    ],
  },
  {
    title: "1. Coach Eligibility, Screening & Required Certifications",
    blocks: [
      p("No coach may begin coaching, supervising minors, or representing PURE in a coaching capacity until all required onboarding items are complete and approved by PURE."),
      b("SafeSport: Coaches who work with minors must complete the SafeSport training designated by PURE before beginning work and keep required training/refresher status current. PURE may require proof of completion at any time."),
      b("Background check: Every coach age 18 or older must successfully complete the background screening designated by PURE before coaching. PURE will pay the standard cost of the required background check."),
      b("CPR/AED and First Aid: Coaches must maintain current certification from a provider accepted by PURE and provide documentation upon request."),
      p("Coaches must promptly disclose to PURE any lapse, suspension, restriction, investigation, criminal charge, or other circumstance that may affect their eligibility to coach or safely supervise participants, subject to applicable law."),
      p("No clearance = no coaching. A coach who has not completed the required SafeSport training, background screening, and other credentials may not be used as an emergency substitute simply because a class needs coverage."),
    ],
  },
  {
    title: "2. Scheduling, Call-Outs & Substitute Coaches",
    blocks: [
      p("Coaches are expected to arrive at least 15 minutes before the scheduled start of a session unless the Program Director establishes a different reporting time."),
      p("If a coach cannot work a scheduled session, the coach must notify the Program Director or designated scheduling contact as soon as coverage is needed. Except for emergencies, notice should be provided at least 24 hours in advance whenever reasonably possible."),
      p("A coach must not cancel a PURE session directly with families or independently select an outside substitute unless authorized by PURE."),
      p("The coach should assist in locating coverage from PURE's approved coach/substitute list, but final approval and assignment of the substitute belongs to PURE."),
      p("Substitute coaches must satisfy the same SafeSport, background-check, certification, and onboarding requirements as the assigned coach before supervising participants."),
      p("For a same-day emergency, contact the Program Director immediately by the designated urgent-contact method. Texting another coach alone does not complete the call-out requirement unless PURE has confirmed coverage."),
      p("Repeated tardiness, late call-outs, no-shows, or unauthorized substitutions may result in removal from the schedule or other corrective action."),
    ],
  },
  {
    title: "3. Student Roster, Health Information & Confidentiality",
    blocks: [
      p("Maintain access to the current roster for the group, including each participant's full name and at least two emergency contacts when supplied by the parent/guardian."),
      p("Review available medical alerts, allergies, physical limitations, emergency action information, and parent-provided instructions before the session."),
      p("Treat participant medical and contact information as confidential. Do not photograph, copy, download, forward, or use it for any non-PURE purpose."),
      p("Emergency medication: Follow PURE's facility and medication policy. Medication should remain in original/labeled packaging and be handled only as authorized by the parent/guardian and PURE. Coaches should not make independent medical judgments beyond their training and the participant's documented emergency plan."),
      p("Immediately report conflicting, incomplete, or concerning medical instructions to the Program Director before the participant takes part when practicable."),
    ],
  },
  {
    title: "4. Arrival, Early Drop-Off & Attendance",
    blocks: [
      p("Take attendance at the start of every session and keep an accurate record in the system or form designated by PURE."),
      p("PURE supervision begins only at the stated check-in/supervision time. A child who arrives earlier remains the responsibility of the parent/guardian unless a PURE staff member has affirmatively accepted supervision."),
      p("Do not allow an early-arriving child to remain alone on a court, in a hallway, lobby, parking area, or other unsupervised location. Direct the parent/guardian to remain with the child until supervision begins, or transfer the child to authorized PURE staff when available."),
      p("If a student is expected but absent, follow the attendance procedure designated by PURE. For youth programs requiring absence verification: contact the parent/guardian, document the attempt/outcome, and notify the Program Director of unexplained or repeated absences."),
      p("Do not leave the assigned participant group unattended to look for a missing or late participant. Request assistance from another authorized staff member."),
    ],
  },
  {
    title: "5. Supervision & Minor-Athlete Safety",
    blocks: [
      p("All coach interactions with minors must remain professional, appropriate to the sport, and consistent with PURE's child-safety standards."),
      p("One-on-one interactions with a minor should be observable and interruptible. Avoid being alone with a single minor in a closed or isolated area except when an immediate emergency makes it unavoidable."),
      p("Whenever possible, maintain a two-adult or group environment during transitions, individual instruction, early arrival, and late pickup."),
      p("Parents/guardians may observe their child's individual training from an appropriate viewing area, subject to normal facility rules and safety restrictions."),
      p("No sexual, romantic, hazing, bullying, harassing, humiliating, retaliatory, or grooming behavior is permitted. Physical contact must be limited to what is reasonably necessary for safe, age-appropriate coaching and should be explained before contact whenever practical."),
      p("Do not enter a restroom, locker room, or changing area with a minor except as permitted by PURE policy for a genuine safety need, and then use the least-intrusive, most observable approach reasonably available."),
    ],
  },
  {
    title: "6. Communications, Phones, Photos & Social Media",
    blocks: [
      p("Use PURE-approved communication channels for program-related communication whenever available."),
      p("Electronic communication with a minor must be open and transparent. Include the parent/guardian or another authorized adult on texts, emails, direct messages, video calls, and similar communications with minors."),
      p("Do not engage in disappearing-message communications, secret/private chats, flirting, personal late-night messaging, or communication unrelated to the legitimate coaching relationship with a minor."),
      p("Do not post, tag, livestream, or distribute identifiable images/video of a minor unless the participant is covered by PURE's applicable media authorization and the content is appropriate and approved for the intended use."),
      p("Never use a participant's phone, social media account, password, or personal device except in a genuine emergency and only as necessary."),
    ],
  },
  {
    title: "7. Pickup, Authorized Release & Late Pickup",
    blocks: [
      p("Youth participants may be released only to a parent/guardian or other adult authorized under PURE's registration/release procedures."),
      p("If PURE uses a pickup code, password, identification check, or authorized-pickup list, follow that system consistently. When identity or authorization is unclear, do not release the child until authorization is confirmed."),
      p("A coach may not send a child alone into a parking lot, rideshare area, or other location to locate a parent unless PURE has an age-specific independent-release policy authorizing it and the participant is registered for that release method."),
      p("At scheduled pickup time, account for all remaining minors and keep them in a visible, supervised location."),
      p("Late Pickup Procedure:"),
      b("At 5 minutes late: call or message the parent/guardian and confirm the pickup plan."),
      b("At 10 minutes late: attempt the secondary/emergency contacts and notify the Program Director or manager on duty."),
      b("At 15 minutes late: the coach should no longer be the only adult supervising a single minor. Move to a public, observable area and ensure another authorized adult/staff member is present or immediately available whenever practicable."),
      b("At 30 minutes late, or sooner if circumstances create a safety concern: the manager/Program Director will determine escalation, which may include contacting additional emergency contacts or appropriate authorities. Do not independently abandon the child or improvise transportation."),
      p("Document significant or repeated late pickups. PURE may impose late-pickup fees under the family's program terms; coaches should not collect or negotiate fees personally unless directed by PURE."),
      p("Coaches must not take a minor home or transport a minor in a personal vehicle merely because a parent is late."),
    ],
  },
  {
    title: "8. Transportation & Off-Site Activities",
    blocks: [
      p("Coaches may not transport a minor participant in a personal vehicle unless the transportation has been specifically authorized under PURE's written procedures and any required parent/guardian consent has been obtained."),
      p("Avoid one-on-one transportation of a minor. For PURE-organized transportation, follow the staffing, consent, vehicle, insurance, and supervision requirements established for that event."),
      p("Do not arrange rideshares, taxis, or transportation with another family for a minor on the parent's behalf unless PURE's authorized procedure permits it."),
    ],
  },
  {
    title: "9. Professional Coaching Standards",
    blocks: [
      p("Be prepared, punctual, attentive, and actively engaged. Personal phone use should be limited to coaching operations or emergencies while participants are under supervision."),
      p("Use age-appropriate instruction and positive, respectful correction. No profanity directed at participants, degrading language, threats, corporal punishment, humiliating drills, or conditioning used as punishment."),
      p("Maintain appropriate boundaries with participants and families. Do not seek personal favors, loans, gifts of significant value, dates, private social relationships with minors, or other relationships that create an actual or perceived conflict with the coaching role."),
      p("Do not coach while impaired by alcohol, cannabis, illegal drugs, misused medication, or any condition that makes safe supervision unreliable."),
      p("Wear PURE-approved attire and follow facility standards for appearance, court access, equipment, and guest conduct."),
      p("Do not accept private payment for PURE programming, divert PURE participants to unauthorized private lessons, or use PURE participant information for personal business without written authorization."),
    ],
  },
  {
    title: "10. Participant Behavior & Discipline",
    blocks: [
      p("Set clear expectations at the beginning of the session: listen when instruction is given, use equipment safely, respect others, remain in designated areas, and follow coach directions."),
      p("Use progressive, age-appropriate responses: reminder/redirection, brief reset from activity, individual discussion in an observable setting, and escalation to the Program Director/parent when needed."),
      p("A coach may immediately remove a participant from play when conduct creates an immediate safety risk. The participant must remain appropriately supervised until released to an authorized adult."),
      p("Document significant incidents involving threats, fighting, bullying, discriminatory harassment, repeated unsafe behavior, or removal from a session."),
      p("Do not diagnose a child, label behavior with a medical or psychological condition, or promise confidentiality when a safety concern may require reporting."),
    ],
  },
  {
    title: "11. Emergency Response, Injury & Incident Reporting",
    blocks: [
      p("All coaches must know the facility's emergency action plan, address, court/location identifiers, AED location, first-aid location, and how to reach the manager on duty."),
      p("For a serious or potentially life-threatening emergency, call 911 immediately. When uncertain about the seriousness of a condition, prioritize participant safety and obtain emergency assistance."),
      p("Provide care only within the coach's training and certification. Do not administer medication, diagnose, or perform a procedure beyond authorized emergency-response protocols."),
      p("Once emergency assistance is underway, notify the parent/guardian and Program Director as soon as reasonably possible without delaying urgent care."),
      p("Remain with the participant until responsibility is transferred to EMS, a parent/guardian, or another authorized person. Maintain supervision of the rest of the group through another coach/staff member when possible."),
      p("Complete PURE's incident/injury report before leaving when feasible, and no later than 24 hours after the event unless medical circumstances prevent it. Record facts, not speculation."),
      p("Report damaged equipment, unsafe surfaces, heat concerns, lighting failures, or other hazards promptly and stop or relocate activity when continued use would be unsafe."),
    ],
  },
  {
    title: "12. Reporting Safety, Abuse or Misconduct Concerns",
    blocks: [
      p("A coach must immediately report suspected abuse, neglect, sexual misconduct, grooming, threats, or other serious child-safety concerns through the channels required by law and PURE policy."),
      p("Do not conduct your own investigation, confront an accused person, pressure a child for details, or promise that information will remain secret. Listen, preserve the participant's words as accurately as possible, and report promptly."),
      p("Notify the Program Director or designated PURE safeguarding contact as soon as possible unless doing so would interfere with emergency or legally required reporting."),
      p("Retaliation against anyone who raises a good-faith safety concern or participates in a review is prohibited."),
    ],
  },
  {
    title: "12A. Zero Tolerance for Sexual Harassment and Sexual Misconduct",
    blocks: [
      p("PURE prohibits sexual harassment, sexual misconduct, and retaliation. This policy applies to every coach, including substitutes and independent contractors, in interactions with minors, adults, participants, families, colleagues, volunteers, and others connected with PURE. It covers in-person and electronic conduct during PURE activities and off-site or off-duty conduct connected to coaching or participant safety."),
      p("Prohibited conduct includes unwanted sexual advances or requests for sexual favors; sexual comments, jokes, gestures, or remarks about a person's body; inappropriate or unwanted touching; sexual assault or exploitation; grooming; sexual hazing or bullying; and creating, requesting, showing, sending, or sharing inappropriate sexualized content. Offering benefits or threatening adverse treatment based on sexual cooperation is prohibited. Conduct may violate PURE policy even if it does not meet a legal definition of harassment."),
      p("Minors and adult participants: Coaches must never pursue or engage in sexual or romantic conduct with a minor participant, regardless of claimed consent or parental approval, or expose a minor to sexualized communications or content. Coaches must not exploit authority, trust, or dependency with any participant. PURE prohibits sexual or romantic relationships with an adult participant while the coach has coaching, supervisory, evaluative, or selection authority over that person."),
      p("Immediate reporting and escalation: Coaches must immediately report observed, disclosed, or suspected sexual harassment, misconduct, grooming, or retaliation to the Program Director or designated PURE safeguarding contact. If that person is implicated, unavailable, or fails to act, report directly to an uninvolved PURE owner or senior manager without delay. Anyone may bypass the usual chain. Call 911 for immediate danger or urgent medical assistance."),
      p("External reporting: Internal notice and an incident report do not replace or delay required reports to law enforcement, child-protection authorities, or the U.S. Center for SafeSport when its jurisdiction applies. Suspected child abuse must be reported immediately through the channels required by applicable law, including Arizona law where applicable. PURE approval is never required to contact authorities."),
      p("No retaliation: Threats, intimidation, punishment, reduced assignments, exclusion, or other adverse treatment because someone makes a good-faith report or participates in an investigation are prohibited."),
      p("Protective measures and consequences: PURE may immediately remove a coach from participant contact, restrict duties, or suspend coaching pending review when warranted for safety. Confirmed violations, retaliation, failure to make required reports, or obstruction may result in discipline up to immediate termination, subject to applicable law."),
    ],
  },
  {
    title: "13. Session-Ready Coach Checklist",
    blocks: [
      c("Arrive at least 15 minutes early and check in as required"),
      c("Confirm assigned court/space is safe and ready"),
      c("Current roster and attendance method available"),
      c("Emergency contacts and relevant medical alerts accessible"),
      c("Emergency medication process confirmed when applicable"),
      c("First-aid kit and AED location known"),
      c("Paddles, balls, nets, ball caddy and teaching aids ready"),
      c("Pickup/release information available for youth sessions"),
      c("Phone charged and manager/Program Director contact available"),
      c("Lesson plan appropriate for participant ages and skill levels"),
    ],
  },
  {
    title: "14. Coach Equipment & Daily Needs",
    blocks: [
      b("Administrative tools: clipboard/pens when required, roster/attendance access, charged phone or tablet, and access to the incident-report process."),
      b("Safety: first-aid kit supplied or designated by PURE/HonorHealth, water/heat-safety resources as applicable, and knowledge of the nearest AED."),
      b("Pickleball/padel equipment as assigned: nets, balls, paddles/rackets, ball caddy, cones/markers, and other teaching aids."),
      b("Storage: return equipment to the designated secured storage location. Report missing, damaged, or unsafe equipment rather than leaving it for the next coach."),
    ],
  },
  {
    title: "15. Administration, Policy Changes & Questions",
    blocks: [
      p("This handbook establishes minimum standards and may be supplemented by program-specific procedures, facility rules, employment/contractor policies, tournament rules, insurance requirements, and applicable law."),
      p("When two rules appear to conflict, stop and ask the Program Director or manager on duty before proceeding unless immediate action is necessary to protect health or safety."),
      p("PURE may revise this handbook. Coaches are responsible for reviewing updates and signing a new acknowledgment when requested."),
      p("Nothing in this handbook is intended to alter a coach's separate employment or independent-contractor classification, compensation terms, or written services agreement. Those matters are governed by the applicable written agreement and law."),
    ],
  },
  {
    title: "Coach Acknowledgment & Agreement",
    blocks: [
      p("By coaching with PURE, Coach acknowledges receiving and reviewing the PURE Coaching Handbook & Agreement and agrees to follow its safety, supervision, conduct, attendance, communication, emergency, and operational requirements, together with applicable PURE policies and lawful directives. For contracting purposes, PURE is Pickleball at Riverwalk HoldCo, LLC, DBA PURE Pickleball & Padel — Scottsdale."),
      p("Eligibility to Coach: Coach will not coach or supervise participants until all required credentials are current and approved (SafeSport, background screening, CPR/AED/First Aid). PURE will pay the standard cost of the background screening it requires."),
      p("Minor-Athlete Safety: Coach agrees to maintain professional boundaries; avoid private or hidden one-on-one interactions with minors; follow PURE's release, transportation, communication, photography/media, and reporting procedures; and immediately escalate safety concerns."),
      p("Scheduling and Coverage: Coach agrees to report absences/tardiness promptly, assist with coverage when requested, and use only substitutes approved by PURE. For planned absences, request a substitute from the Academy Director at least two weeks in advance whenever reasonably possible."),
      p("Sexual Harassment and Misconduct: Coach acknowledges Section 12A, agrees to its zero-tolerance standards for minors and adults, and will comply with immediate reporting, non-retaliation, cooperation, and protective-measure requirements."),
      p("A written acknowledgment is captured separately at onboarding. Questions about any of these requirements should go to the Academy Director or Program Director."),
    ],
  },
];
