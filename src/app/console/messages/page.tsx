import { prisma } from "@/lib/db";
import { PageHeader, RoadmapNote } from "@/components/RoadmapNote";

export const dynamic = "force-dynamic";

const TRIGGERS = [
  ["Registration received", "Player, parent", "Immediate"],
  ["Team assignment", "Player, parent", "On assignment"],
  ["Payment request", "Player, parent", "After assignment"],
  ["Waiver outstanding", "Player, parent", "On registration, then reminders"],
  ["DUPR account outstanding", "Player, parent", "Before Week 7"],
  ["Practice cancelled", "Team, parents, coach", "Immediate · SMS"],
  ["Match details + availability request", "Team, parents, coach", "7 days before match"],
  ["Availability not confirmed", "Contact, Director, COO", "48 hours before match"],
  ["Reschedule requested", "Opposing contact, Director", "Immediate"],
  ["Forfeit recorded", "Both teams, contacts, Director, COO", "Immediate"],
  ["Evaluation published", "Player, parent", "Weeks 1, 6, 12"],
  ["Result + rating submitted", "Team", "After DUPR submission"],
];

export default async function MessagesPage() {
  const messages = await prisma.message.findMany({
    orderBy: { sentAt: "desc" },
    take: 30,
    include: { _count: { select: { recipients: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Communications" subtitle="A core capability — every message logged per person and per team, so “we told them” is verifiable." />

      <RoadmapNote phase="Phase 1 → 2">
        In-platform composer with email mirror and SMS for time-critical items, plus the
        triggered-message engine below. Cancellation and forfeit messages treat delivery
        failure as an error state, not a silent drop.
      </RoadmapNote>

      <div className="grid gap-6 lg:grid-cols-2">
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
        </div>

        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-900">Recent messages</h2>
          {messages.length === 0 ? (
            <p className="text-sm text-slate-400">No messages sent yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {messages.map((m) => (
                <li key={m.id} className="py-2">
                  <div className="flex justify-between">
                    <span className="font-medium text-slate-800">{m.subject ?? m.triggerType ?? "Message"}</span>
                    <span className="text-xs text-slate-400">{m._count.recipients} recipients</span>
                  </div>
                  <div className="text-xs text-slate-400">{m.audienceType.replace(/_/g, " ")} · {m.channels}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
