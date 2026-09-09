import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket } from "@/lib/auth";
import { requireAdmin } from "@/lib/rbac";
import { getSeasonStats } from "@/lib/domain/seasonStats";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { formatStamp } from "@/lib/time";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  sent: "Feedback request sent.",
  moderated: "Updated.",
  published: "Testimonial published.",
  unpublished: "Testimonial unpublished.",
};
const ERR: Record<string, string> = {
  auth: "Not authorized.",
  noseason: "No active season to send for.",
  noconsent: "That family didn't consent to publishing — can't publish it.",
};

const PHASE_LABEL: Record<string, string> = { MIDSEASON: "Mid-season", ENDSEASON: "End of season", GENERAL: "General", ALACARTE: "Private / clinic" };

export default async function FeedbackConsole({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const stats = await getSeasonStats();

  const familyCount = stats.season
    ? (await prisma.registration.findMany({ where: { seasonId: stats.season.id, status: { notIn: ["WITHDRAWN", "DUPLICATE", "MERGED"] } }, select: { personId: true } })).reduce((set, r) => set.add(r.personId), new Set<string>()).size
    : 0;

  const feedback = await prisma.feedback.findMany({ orderBy: { createdAt: "desc" }, take: 300 });
  const coachIds = [...new Set(feedback.map((f) => f.coachId).filter(Boolean) as string[])];
  const coaches = coachIds.length
    ? await prisma.coach.findMany({ where: { id: { in: coachIds } }, select: { id: true, person: { select: { firstName: true, lastName: true } } } })
    : [];
  const coachName = new Map(coaches.map((c) => [c.id, `${c.person.firstName} ${c.person.lastName}`]));

  const withRating = feedback.filter((f) => f.rating);
  const avg = withRating.length ? (withRating.reduce((s, f) => s + (f.rating ?? 0), 0) / withRating.length).toFixed(1) : "—";

  return (
    <div className="space-y-6">
      <PageHeader title="Season feedback & testimonials" subtitle="Thank families and collect feedback mid-season and at the end — then publish the best testimonials to coach profiles." />

      {sp.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{OK[sp.ok] ?? "Done."}{sp.ok === "sent" && sp.n ? ` (${sp.n} famil${sp.n === "1" ? "y" : "ies"})` : ""}</p>}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{ERR[sp.err] ?? "Something went wrong."}</p>}

      {/* Send the request */}
      <div className="card">
        <h2 className="font-semibold text-slate-900">Send a feedback request</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Texts and emails every family in the active season a thank-you and a one-tap feedback link
          {stats.season ? <> — <strong>{familyCount}</strong> famil{familyCount === 1 ? "y" : "ies"} this season</> : " (no active season)"}.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ConfirmSubmit
            action="/api/console/feedback"
            fields={{ ticket, op: "sendCampaign", phase: "MIDSEASON" }}
            confirm={`Text + email all ${familyCount} families a mid-season thank-you and feedback link?`}
            label="Send mid-season request"
            className="btn-secondary text-sm"
          />
          <ConfirmSubmit
            action="/api/console/feedback"
            fields={{ ticket, op: "sendCampaign", phase: "ENDSEASON" }}
            confirm={`Text + email all ${familyCount} families an end-of-season thank-you and feedback link?`}
            label="Send end-of-season request"
            className="btn-primary text-sm"
          />
        </div>
      </div>

      {/* Responses */}
      <div className="card">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Responses</h2>
          <span className="text-sm text-slate-500">{feedback.length} total · avg rating {avg}★</span>
        </div>
        {feedback.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No feedback yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {feedback.map((f) => (
              <li key={f.id} className={`rounded-xl border p-3 ${f.status === "HIDDEN" ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {f.rating ? <span className="font-semibold text-amber-500">{"★".repeat(f.rating)}<span className="text-slate-300">{"★".repeat(5 - f.rating)}</span></span> : <span className="text-slate-400">no rating</span>}
                  {f.coachId && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{coachName.get(f.coachId) ?? "coach"}</span>}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{PHASE_LABEL[f.phase ?? "GENERAL"] ?? f.phase}</span>
                  {f.published && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Published</span>}
                  <span className="ml-auto text-xs text-slate-400">{formatStamp(f.createdAt)}</span>
                </div>
                {f.body && <p className="mt-1.5 text-sm text-slate-700">“{f.body}”</p>}
                <div className="mt-1 text-xs text-slate-400">
                  — {f.respondentName || "a family"}{f.consentPublish ? " · consented to publish" : " · did not consent to publish"}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {f.consentPublish && f.coachId && (
                    f.published ? (
                      <MiniForm ticket={ticket} op="publish" id={f.id} extra={{ on: "0" }} label="Unpublish" className="text-xs font-medium text-slate-500 hover:underline" />
                    ) : (
                      <MiniForm ticket={ticket} op="publish" id={f.id} extra={{ on: "1" }} label="Publish to coach profile" className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700" />
                    )
                  )}
                  {f.status !== "HIDDEN" ? (
                    <MiniForm ticket={ticket} op="setStatus" id={f.id} extra={{ status: "HIDDEN" }} label="Hide" className="text-xs font-medium text-rose-600 hover:underline" />
                  ) : (
                    <MiniForm ticket={ticket} op="setStatus" id={f.id} extra={{ status: "REVIEWED" }} label="Unhide" className="text-xs font-medium text-brand-600 hover:underline" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MiniForm({ ticket, op, id, extra, label, className }: { ticket: string; op: string; id: string; extra?: Record<string, string>; label: string; className: string }) {
  return (
    <form method="POST" action="/api/console/feedback">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className={className}>{label}</button>
    </form>
  );
}
