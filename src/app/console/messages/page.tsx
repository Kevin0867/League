import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { MessageComposer } from "@/components/MessageComposer";
import { requireAdmin } from "@/lib/rbac";
import { can } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { smsConfigured, emailConfigured } from "@/lib/notify";

const ERRORS: Record<string, string> = {
  auth: "Not signed in.",
  body: "Message body is required.",
  channels: "Select at least one channel.",
  perm: "You don't have permission to message that audience.",
  team: "You can only message your own team.",
  norecipients: "No recipients matched that audience.",
  op: "Unknown operation.",
};

export const dynamic = "force-dynamic";

const TRIGGERS = [
  ["Registration received", "Player, parent", "Immediate"],
  ["Team assignment", "Player, parent", "On assignment"],
  ["Payment request", "Player, parent", "After assignment"],
  ["Practice cancelled", "Team, parents, coach", "Immediate · SMS"],
  ["Match details + availability request", "Team, parents, coach", "7 days before match"],
  ["Availability not confirmed", "Contact, Director, COO", "48 hours before · SMS"],
  ["Forfeit recorded", "Both teams, contacts, Director, COO", "Immediate"],
];

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await requireAdmin();
  const canBroadcast = can(session.role, "broadcastAll");
  const ticket = await mintConsoleTicket();

  const successNote = sp.ok
    ? `Sent to ${sp.n ?? "0"} recipient${sp.n === "1" ? "" : "s"}` +
      (sp.failed && sp.failed !== "0"
        ? ` · ${sp.failed} delivery failure${sp.failed === "1" ? "" : "s"} flagged`
        : "")
    : null;
  const hasFailures = sp.ok && sp.failed && sp.failed !== "0";

  const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" } });

  const [teams, divisions, coaches, people, messages] = await Promise.all([
    // Coaches can only address their own team.
    prisma.team.findMany({
      where: canBroadcast ? {} : { coach: { personId: session.personId ?? "" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.division.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.coach.findMany({ include: { person: true }, orderBy: { person: { lastName: "asc" } } }),
    prisma.person.findMany({ select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" }, take: 500 }),
    prisma.message.findMany({
      orderBy: { sentAt: "desc" },
      take: 25,
      include: { recipients: { select: { failedReason: true } }, sender: { include: { person: true } } },
    }),
  ]);

  const markets = [...new Set((await prisma.team.findMany({ select: { market: true } })).map((t) => t.market).filter(Boolean))] as string[];

  return (
    <div className="space-y-6">
      <PageHeader title="Communications" subtitle="A core capability — every message logged per person and per team, so “we told them” is verifiable." />

      {successNote && (
        <p className={`rounded-lg px-3 py-2 text-sm ${hasFailures ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
          {successNote}
        </p>
      )}
      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        <Chan label="In-app" on />
        <Chan label="Email" on={emailConfigured()} note={emailConfigured() ? undefined : "simulated"} />
        <Chan label="SMS" on={smsConfigured()} note={smsConfigured() ? undefined : "simulated"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <MessageComposer
          canBroadcast={canBroadcast}
          teams={teams}
          divisions={divisions}
          coaches={coaches.map((c) => ({ id: c.id, name: `${c.person.firstName} ${c.person.lastName}` }))}
          people={people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))}
          markets={markets}
          ticket={ticket}
        />

        <div className="space-y-6">
          <div className="card">
            <h2 className="mb-3 font-semibold text-slate-900">Recent messages</h2>
            {messages.length === 0 ? (
              <p className="text-sm text-slate-400">No messages sent yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {messages.map((m) => {
                  const failures = m.recipients.filter((r) => r.failedReason).length;
                  return (
                    <li key={m.id} className="py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-800">{m.subject ?? m.triggerType ?? "Message"}</span>
                        <span className="text-xs text-slate-400">{m.recipients.length} recipients</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span>{m.audienceType.replace(/_/g, " ")}</span>
                        <span>· {m.channels}</span>
                        {failures > 0 && <span className="badge bg-rose-100 text-rose-800">{failures} failed</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="card">
            <h2 className="mb-3 font-semibold text-slate-900">Triggered messages</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr><th className="py-1">Trigger</th><th>Recipients</th><th>Timing</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {TRIGGERS.map((t) => (
                    <tr key={t[0]}>
                      <td className="py-1.5 font-medium text-slate-700">{t[0]}</td>
                      <td className="text-slate-500">{t[1]}</td>
                      <td className="text-slate-500">{t[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Team assignment and payment-request triggers already fire automatically from the
              assignment and billing actions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chan({ label, on, note }: { label: string; on: boolean; note?: string }) {
  return (
    <span className={`badge ${on ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
      {label}: {on ? "live" : note ?? "off"}
    </span>
  );
}
