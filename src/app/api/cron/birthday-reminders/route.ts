import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendSms, sendEmail } from "@/lib/notify";

// Daily birthday reminders. The day BEFORE a rostered player's birthday, each of
// their coaches gets a heads-up by text + email so they can acknowledge it at
// the next practice. Runs once a day; idempotent via Person.birthdayRemindedOn
// (the YYYY-MM-DD birthday occurrence already reminded), so a re-run or a player
// on two teams never double-notifies the same coach.
export const dynamic = "force-dynamic";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  // "Tomorrow" on the Phoenix calendar.
  const nowPhx = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" }));
  const tomorrow = new Date(nowPhx);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tMonth = tomorrow.getMonth();
  const tDay = tomorrow.getDate();
  const targetStr = `${tomorrow.getFullYear()}-${String(tMonth + 1).padStart(2, "0")}-${String(tDay).padStart(2, "0")}`;
  const prettyDate = `${MONTHS[tMonth]} ${tDay}`;

  // Rostered players on an active, real PURE season who have a birthdate — with
  // each team's head + assistant coaches' contact.
  const coachSel = { person: { select: { firstName: true, lastName: true, email: true, phone: true } } } as const;
  const members = await prisma.teamMember.findMany({
    where: { team: { season: { active: true, isTest: false } }, person: { dob: { not: null } } },
    select: {
      person: { select: { id: true, firstName: true, lastName: true, dob: true, birthdayRemindedOn: true } },
      team: {
        select: {
          name: true,
          coach: { select: coachSel },
          assistantCoaches: { select: { coach: { select: coachSel } } },
        },
      },
    },
  });

  // Group by player: whose birthday is tomorrow and hasn't been reminded yet.
  type CoachContact = { name: string; email: string | null; phone: string | null };
  const byPerson = new Map<string, { first: string; last: string; teams: Set<string>; coaches: Map<string, CoachContact> }>();
  for (const m of members) {
    const p = m.person;
    if (!p.dob) continue;
    const dob = p.dob;
    if (dob.getUTCMonth() !== tMonth || dob.getUTCDate() !== tDay) continue; // not tomorrow
    if (p.birthdayRemindedOn === targetStr) continue; // already reminded this year

    let entry = byPerson.get(p.id);
    if (!entry) {
      entry = { first: p.firstName, last: p.lastName, teams: new Set(), coaches: new Map() };
      byPerson.set(p.id, entry);
    }
    entry.teams.add(m.team.name);
    const coaches = [m.team.coach, ...m.team.assistantCoaches.map((a) => a.coach)].filter(Boolean);
    for (const c of coaches) {
      const cp = c?.person;
      if (!cp || (!cp.email && !cp.phone)) continue;
      const key = `${cp.email ?? ""}|${cp.phone ?? ""}`;
      if (!entry.coaches.has(key)) entry.coaches.set(key, { name: cp.firstName, email: cp.email, phone: cp.phone });
    }
  }

  let notified = 0;
  const remindedPersonIds: string[] = [];
  for (const [personId, e] of byPerson) {
    const player = `${e.first} ${e.last}`.trim();
    for (const c of e.coaches.values()) {
      const sms = `PURE Academy: 🎂 ${player}'s birthday is tomorrow (${prettyDate}) — a quick shout-out at practice goes a long way!`;
      if (c.phone) await sendSms(c.phone, sms).catch(() => {});
      if (c.email) {
        await sendEmail(
          c.email,
          `Birthday tomorrow: ${player}`,
          `Hi ${c.name},\n\nJust a heads-up — ${player}'s birthday is tomorrow, ${prettyDate}. A quick happy birthday at practice always means a lot.\n\n— PURE Academy`,
        ).catch(() => {});
      }
      notified++;
    }
    remindedPersonIds.push(personId);
  }

  // Stamp so we don't remind again for this birthday, even if the job re-runs.
  if (remindedPersonIds.length) {
    await prisma.person.updateMany({ where: { id: { in: remindedPersonIds } }, data: { birthdayRemindedOn: targetStr } });
  }

  return NextResponse.json({ ok: true, date: targetStr, players: remindedPersonIds.length, coachNotifications: notified });
}
