import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { canViewTeamNotes } from "@/lib/domain/coachingAccess";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { RecipientChecklist } from "@/components/RecipientChecklist";
import { SpeechToTextArea } from "@/components/SpeechToTextArea";
import { formatStamp } from "@/lib/time";
import {
  COACHING_WEEKS,
  NOTE_CATALOG,
  parseTags,
  noteHasContent,
} from "@/lib/domain/coachingNotes";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  saved: "Week saved.",
  sent: "Progress report emailed to the parent/guardian.",
  sentsim: "Report generated — email provider isn't configured, so nothing was actually delivered.",
};
const ERR: Record<string, string> = {
  auth: "You can only manage progress notes for your own teams.",
  week: "Pick a valid week (1–6).",
  notmember: "That player isn't on this team's roster.",
  empty: "Add a tag or a note before sending a report.",
  noemail: "No parent/guardian email on file — add one on the player's record first.",
  norecipients: "Select at least one recipient before sending.",
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
  if (!(await canViewTeamNotes(teamId))) redirect("/console/teams");
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
  const byWeek = new Map(notes.map((n) => [n.week, n]));
  const active = Math.min(Math.max(parseInt(sp.week ?? "", 10) || firstOpenWeek(byWeek), 1), COACHING_WEEKS.length);
  const note = byWeek.get(active);
  const strengths = parseTags(note?.strengths);
  const growth = parseTags(note?.growth);


  return (
    <div className="space-y-6">
      <div>
        <Link href={`/console/teams/${teamId}/progress`} className="text-sm text-brand-600 hover:underline">← {team.name} roster</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{student.firstName} {student.lastName}</h1>
        <p className="text-sm text-slate-500">Progress notes · {team.name}</p>
      </div>

      {sp.ok && OK[sp.ok] && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{OK[sp.ok]}</p>}
      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {ERR[sp.err] ?? "Something went wrong."}{sp.reason ? ` — ${sp.reason}` : ""}
        </p>
      )}

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
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ring-1 ring-inset transition-colors ${
                on ? "bg-brand-900 text-white ring-brand-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              <span>Week {w}</span>
              {sent ? <span className={on ? "text-emerald-300" : "text-emerald-600"}>✓</span>
                : has ? <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-accent-400" : "bg-amber-400"}`} />
                : null}
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
            Choose who receives it — checked by default for parents/guardians.
            {note?.sentToParentAt && <span className="ml-1 text-emerald-700">Last sent {formatStamp(note.sentToParentAt)}.</span>}
          </p>
        </div>
        <RecipientChecklist person={student} guardian={student.guardian} purpose="report" />
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
