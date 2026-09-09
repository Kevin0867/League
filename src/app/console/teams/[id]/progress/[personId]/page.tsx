import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { canCoverTeamNotes } from "@/lib/domain/coachingAccess";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { RecipientChecklist } from "@/components/RecipientChecklist";
import { SpeechToTextArea } from "@/components/SpeechToTextArea";
import { formatStamp, BUSINESS_TZ } from "@/lib/time";
import { decryptField } from "@/lib/crypto";
import {
  COACHING_WEEKS,
  COACHING_WEEK_COUNT,
  NOTE_CATALOG,
  parseTags,
  noteHasContent,
} from "@/lib/domain/coachingNotes";
import { teamWeekSchedule } from "@/lib/domain/practiceInfo";

export const dynamic = "force-dynamic";

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BUSINESS_TZ });
}

const OK: Record<string, string> = {
  saved: "Note saved — the parent was NOT notified. Use “Send report” below to send it to them.",
  sent: "Progress report sent to the parent/guardian.",
  sentsim: "Report generated — the email/SMS provider isn't configured, so nothing was actually delivered.",
  contact: "Player details saved.",
};
const ERR: Record<string, string> = {
  auth: "You can only manage progress notes for your own teams.",
  week: "Pick a valid week (1–6).",
  notmember: "That player isn't on this team's roster.",
  empty: "Add a tag or a note before sending a report.",
  noemail: "No parent/guardian email on file — add one on the player's record first.",
  norecipients: "Select at least one email recipient, or send by text instead.",
  nophone: "No parent/guardian mobile number on file to text — add one first, or send by email.",
  nodest: "Nothing to send to for the chosen channel — no email address or mobile number on file.",
  sendfail: "The report couldn't be delivered.",
  nostudent: "Player not found.",
  op: "Unknown action.",
};

export default async function StudentProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; personId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id: teamId, personId } = await params;
  const sp = await searchParams;
  if (!(await canCoverTeamNotes(teamId))) redirect("/console/teams");
  const ticket = await mintConsoleTicket();

  const [team, member, notes] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId }, include: { coach: { include: { person: true } } } }),
    prisma.teamMember.findUnique({
      where: { teamId_personId: { teamId, personId } },
      include: { person: { include: { guardian: true } } },
    }),
    prisma.coachingNote.findMany({ where: { teamId, personId } }),
  ]);
  if (!team) notFound();
  if (!member) redirect(`/console/teams/${teamId}?err=notfound`);

  const student = member.person;
  // These fields are encrypted at rest — decrypt for the coach to view/edit their
  // own player's details. Access is already scoped to this team's roster above.
  const emergencyName = decryptField(student.emergencyName);
  const emergencyPhone = decryptField(student.emergencyPhone);
  const emergencyRelation = decryptField(student.emergencyRelation);
  const emergencyName2 = decryptField(student.emergencyName2);
  const emergencyPhone2 = decryptField(student.emergencyPhone2);
  const emergencyRelation2 = decryptField(student.emergencyRelation2);
  const address = decryptField(student.address);
  const medicalNotes = decryptField(student.medicalNotes);
  const dobInput = student.dob ? new Date(student.dob).toISOString().slice(0, 10) : "";
  const byWeek = new Map(notes.map((n) => [n.week, n]));
  const { slots: weekSlots } = await teamWeekSchedule(team, team.seasonId, COACHING_WEEK_COUNT);
  const dateByWeek = new Map(weekSlots.map((s) => [s.week, s.date]));
  const active = Math.min(Math.max(parseInt(sp.week ?? "", 10) || firstOpenWeek(byWeek), 1), COACHING_WEEKS.length);
  const note = byWeek.get(active);
  const strengths = parseTags(note?.strengths);
  const growth = parseTags(note?.growth);


  return (
    <div className="space-y-6">
      <div>
        <Link href={`/console/teams/${teamId}/progress`} className="btn-back">← {team.name} roster</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{student.firstName} {student.lastName}</h1>
        <p className="text-sm text-slate-500">Progress notes · {team.name}</p>
      </div>

      {sp.ok && OK[sp.ok] && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {OK[sp.ok]}{(sp.ok === "sent" || sp.ok === "sentsim") && sp.via ? ` Sent via ${sp.via}.` : ""}
        </p>
      )}
      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {ERR[sp.err] ?? "Something went wrong."}{sp.reason ? ` — ${sp.reason}` : ""}
        </p>
      )}

      {/* Player details — the full profile a coach can keep current: contact,
          emergency contact, and any medical notes that matter courtside.
          Collapsed by default so the week notes stay the focus. */}
      <details className="card">
        <summary className="cursor-pointer list-none font-semibold text-slate-900">
          Player details &amp; emergency contact
          <span className="ml-2 text-sm font-normal text-slate-400">— contact, emergency, medical</span>
        </summary>
        <form method="POST" action="/api/console/coach-contact" className="mt-4 space-y-5">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="teamId" value={teamId} />
          <input type="hidden" name="personId" value={personId} />

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Player contact</div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div><label className="label">First name</label><input name="firstName" defaultValue={student.firstName} className="input" /></div>
              <div><label className="label">Last name</label><input name="lastName" defaultValue={student.lastName} className="input" /></div>
              <div><label className="label">Email</label><input name="email" type="email" defaultValue={student.email ?? ""} className="input" /></div>
              <div><label className="label">Mobile</label><input name="phone" type="tel" defaultValue={student.phone ?? ""} className="input" /></div>
              <div><label className="label">Additional email</label><input name="email2" type="email" defaultValue={student.email2 ?? ""} className="input" /></div>
              <div><label className="label">Additional email</label><input name="email3" type="email" defaultValue={student.email3 ?? ""} className="input" /></div>
              <div className="sm:col-span-2"><label className="label">Address</label><input name="address" defaultValue={address ?? ""} className="input" /></div>
              <div><label className="label">Date of birth</label><input name="dob" type="date" defaultValue={dobInput} className="input" /></div>
              <div><label className="label">Gender</label><input name="gender" defaultValue={student.gender ?? ""} className="input" /></div>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Emergency contact 1</div>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div><label className="label">Name</label><input name="emergencyName" defaultValue={emergencyName ?? ""} className="input" placeholder="e.g. Jane Doe" /></div>
              <div><label className="label">Relationship</label><input name="emergencyRelation" defaultValue={emergencyRelation ?? ""} className="input" placeholder="e.g. Mother" /></div>
              <div><label className="label">Phone</label><input name="emergencyPhone" type="tel" defaultValue={emergencyPhone ?? ""} className="input" /></div>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Emergency contact 2</div>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div><label className="label">Name</label><input name="emergencyName2" defaultValue={emergencyName2 ?? ""} className="input" placeholder="e.g. John Doe" /></div>
              <div><label className="label">Relationship</label><input name="emergencyRelation2" defaultValue={emergencyRelation2 ?? ""} className="input" placeholder="e.g. Father" /></div>
              <div><label className="label">Phone</label><input name="emergencyPhone2" type="tel" defaultValue={emergencyPhone2 ?? ""} className="input" /></div>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Medical notes</div>
            <p className="mt-1 text-xs text-slate-400">Allergies, conditions, or anything to know at practice. Kept private to staff.</p>
            <textarea name="medicalNotes" rows={3} defaultValue={medicalNotes ?? ""} className="input mt-2 w-full" placeholder="e.g. Peanut allergy — carries an EpiPen. Mild asthma." />
          </div>

          {student.guardian ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Parent / guardian{student.guardian.firstName ? ` — ${student.guardian.firstName} ${student.guardian.lastName}` : ""}
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div><label className="label">Parent email</label><input name="guardianEmail" type="email" defaultValue={student.guardian.email ?? ""} className="input" /></div>
                <div><label className="label">Parent mobile</label><input name="guardianPhone" type="tel" defaultValue={student.guardian.phone ?? ""} className="input" /></div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">No parent/guardian is linked to this player.</p>
          )}
          <div className="flex justify-end">
            <button className="btn-primary text-sm">Save details</button>
          </div>
        </form>
      </details>

      {/* Week selector — one section per week, a dot when a week has content and a
          check once it's been shared with the parent. */}
      <div className="flex flex-wrap gap-2">
        {COACHING_WEEKS.map((w) => {
          const n = byWeek.get(w);
          const has = n ? noteHasContent(n) : false;
          const sent = !!n?.sentToParentAt;
          const on = w === active;
          return (
            <Link
              key={w}
              href={`/console/teams/${teamId}/progress/${personId}?week=${w}`}
              className={`flex flex-col items-center rounded-md px-3 py-1.5 text-sm font-semibold ring-1 ring-inset transition-colors ${
                on ? "bg-brand-900 text-white ring-brand-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center gap-1.5">
                Week {w}
                {sent ? <span className={on ? "text-emerald-300" : "text-emerald-600"}>✓</span>
                  : has ? <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-accent-400" : "bg-amber-400"}`} />
                  : null}
              </span>
              {dateByWeek.get(w) && (
                <span className={`text-[10px] font-normal ${on ? "text-white/70" : "text-slate-400"}`}>{shortDate(dateByWeek.get(w) as Date)}</span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Editor for the active week */}
      <form method="POST" action="/api/console/coaching-notes" className="card space-y-6">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="saveNote" />
        <input type="hidden" name="teamId" value={teamId} />
        <input type="hidden" name="personId" value={personId} />
        <input type="hidden" name="week" value={active} />

        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Week {active} note</h2>
          {note?.updatedAt && <span className="text-xs text-slate-400">Last saved {formatStamp(note.updatedAt)}</span>}
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-emerald-800">What {student.firstName} excelled at</p>
          <ChipGroup name="strengths" selected={strengths} tone="emerald" />
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-amber-800">What {student.firstName} can work on</p>
          <ChipGroup name="growth" selected={growth} tone="amber" />
        </div>

        <div>
          <label className="label" htmlFor="note">Coach&apos;s note (optional — dictate or type, then edit)</label>
          <SpeechToTextArea
            id="note"
            name="note"
            rows={4}
            defaultValue={note?.note ?? ""}
            ariaLabel={`Coaching note for ${student.firstName}`}
            placeholder={`e.g. ${student.firstName} had a great week on their third-shot drop and was a big help to newer players. Let's keep working on staying back on the return.`}
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">Tap chips to select. Save before sending the report.</p>
          <button className="btn-primary">Save Week {active}</button>
        </div>
      </form>

      {/* Send this week — pick exactly who receives it. Progress reports default
          to the parents/guardians (not a minor's own address). */}
      <form method="POST" action="/api/console/coaching-notes" className="card space-y-3">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="sendReport" />
        <input type="hidden" name="teamId" value={teamId} />
        <input type="hidden" name="personId" value={personId} />
        <input type="hidden" name="week" value={active} />
        <div>
          <h2 className="font-semibold text-slate-900">Send Week {active} report</h2>
          <p className="text-sm text-slate-500">
            Saving a note never emails anyone — the parent only hears from us when you send the report here.
            Choose who receives it — checked by default for parents/guardians.
            {note?.sentToParentAt && <span className="ml-1 text-emerald-700">Last sent {formatStamp(note.sentToParentAt)}.</span>}
          </p>
        </div>
        {note && noteHasContent(note) && !note.sentToParentAt && (
          <p className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            This week&apos;s note is saved but hasn&apos;t been sent to the parent yet.
          </p>
        )}

        {/* How to send — email, text, or both. Email goes to the checked
            addresses below; text goes to the family mobile. */}
        {(() => {
          const familyPhone = (student.isMinor && student.guardian?.phone ? student.guardian.phone : student.phone) ?? "";
          return (
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">Send by</legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {[
                  { v: "email", label: "Email" },
                  { v: "text", label: "Text" },
                  { v: "both", label: "Email & text" },
                ].map((o, i) => (
                  <label key={o.v} className="cursor-pointer">
                    <input type="radio" name="channel" value={o.v} defaultChecked={i === 0} className="peer sr-only" />
                    <span className="inline-block select-none rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:text-brand-800 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400">
                      {o.label}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                Email goes to the checked address(es) below. Text goes to{" "}
                {familyPhone
                  ? `the family mobile (${familyPhone})`
                  : "the family mobile — none on file yet, add one in Contact info above to text"}
                .
              </p>
            </fieldset>
          );
        })()}

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Email recipients</div>
          <RecipientChecklist person={student} guardian={student.guardian} purpose="report" />
        </div>
        <div className="flex justify-end">
          <PendingSubmit label={note?.sentToParentAt ? "Resend report" : "Send report"} className="btn-secondary text-sm" pendingLabel="Sending…" />
        </div>
      </form>
    </div>
  );
}

// First week with no content, so a coach lands on where they left off.
function firstOpenWeek(byWeek: Map<number, { strengths: string; growth: string; note: string | null }>): number {
  for (const w of COACHING_WEEKS) {
    const n = byWeek.get(w);
    if (!n || !noteHasContent(n)) return w;
  }
  return 1;
}

// Server-rendered chip multi-select — peer checkboxes, no client JS. Selecting a
// chip toggles its highlighted state and submits its id under `name`.
function ChipGroup({ name, selected, tone }: { name: "strengths" | "growth"; selected: string[]; tone: "emerald" | "amber" }) {
  const sel = new Set(selected);
  const toneCls =
    tone === "emerald"
      ? "peer-checked:border-emerald-500 peer-checked:bg-emerald-50 peer-checked:text-emerald-800"
      : "peer-checked:border-amber-500 peer-checked:bg-amber-50 peer-checked:text-amber-800";
  return (
    <div className="space-y-3">
      {NOTE_CATALOG.map((g) => (
        <div key={g.title}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.title}</div>
          <div className="flex flex-wrap gap-2">
            {g.tags.map((t) => (
              <label key={t.id} className="cursor-pointer">
                <input type="checkbox" name={name} value={t.id} defaultChecked={sel.has(t.id)} className="peer sr-only" />
                <span className={`inline-block select-none rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 transition hover:border-slate-300 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400 ${toneCls}`}>
                  {t.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
