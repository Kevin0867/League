import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { PageHeader } from "@/components/RoadmapNote";

export const dynamic = "force-dynamic";

const AUDIENCE_LABEL: Record<string, string> = {
  ALL_PLAYERS: "All players", ALL_COACHES: "All coaches", ALL_ADMINS: "All admins",
  PLATFORM: "Platform announcement", MARKET: "Market", DIVISION: "Division", TEAM: "Team",
  SINGLE_COACH: "One coach", SINGLE_PERSON: "One person",
};

function StatusPill({ label, status }: { label: string; status: string | null }) {
  if (!status) return null;
  const tone =
    status === "DELIVERED" || status === "READ" ? "bg-emerald-100 text-emerald-800"
    : status === "SENT" ? "bg-sky-100 text-sky-800"
    : status === "FAILED" ? "bg-rose-100 text-rose-700"
    : status === "SKIPPED" ? "bg-slate-100 text-slate-500"
    : "bg-slate-100 text-slate-600";
  return <span className={`badge ${tone}`}>{label}: {status.toLowerCase()}</span>;
}

function fmt(d: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Phoenix" }).format(d);
}

export default async function MessageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin();

  const message = await prisma.message.findUnique({
    where: { id },
    include: {
      sender: { include: { person: true } },
      recipients: { include: { person: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { person: { lastName: "asc" } } },
    },
  });
  if (!message) redirect("/console/messages");

  const channels = message.channels.split(",").filter(Boolean);
  const failures = message.recipients.filter((r) => r.failedReason).length;

  // The "string of messages" — when this went to a single person, show every
  // Communications message that person has received, as a timeline they can walk.
  const solePerson = message.recipients.length === 1 ? message.recipients[0].person : null;
  const history = solePerson
    ? await prisma.message.findMany({
        where: { recipients: { some: { personId: solePerson.id } } },
        select: { id: true, subject: true, triggerType: true, body: true, channels: true, sentAt: true, audienceType: true },
        orderBy: { sentAt: "desc" },
        take: 100,
      })
    : [];

  return (
    <div className="space-y-6">
      <Link href="/console/messages" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">← Back to Communications</Link>
      <PageHeader
        title={message.subject ?? message.triggerType?.replace(/_/g, " ") ?? "Message"}
        subtitle={`${AUDIENCE_LABEL[message.audienceType] ?? message.audienceType} · ${fmt(message.sentAt)}`}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <div className="card">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              {channels.map((c) => <span key={c} className="badge bg-slate-100 text-slate-600">{c.replace(/_/g, "-").toLowerCase()}</span>)}
              {message.sender?.person && <span className="text-slate-400">from {message.sender.person.firstName} {message.sender.person.lastName}</span>}
              {message.triggerType && <span className="badge bg-brand-50 text-brand-700">{message.triggerType.replace(/_/g, " ").toLowerCase()}</span>}
            </div>
            {message.subject && <h2 className="mb-2 text-lg font-semibold text-slate-900">{message.subject}</h2>}
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{message.body}</div>
          </div>

          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Recipients</h2>
              <span className="text-sm text-slate-400">{message.recipients.length} · {failures > 0 ? `${failures} failed` : "no failures"}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr><th className="py-1">Person</th><th>Delivery</th><th>Read</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {message.recipients.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2">
                        <Link href={`/console/people/${r.person.id}`} className="font-medium text-brand-700 hover:underline">{r.person.firstName} {r.person.lastName}</Link>
                        {r.failedReason && <div className="text-xs text-rose-600">{r.failedReason}</div>}
                      </td>
                      <td className="space-x-1">
                        <StatusPill label="In-app" status={r.inAppStatus} />
                        <StatusPill label="Email" status={r.emailStatus} />
                        <StatusPill label="SMS" status={r.smsStatus} />
                      </td>
                      <td className="text-xs text-slate-400">{r.readAt ? fmt(r.readAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div>
          {solePerson && (
            <div className="card">
              <h2 className="mb-1 font-semibold text-slate-900">All messages to {solePerson.firstName} {solePerson.lastName}</h2>
              <p className="mb-3 text-xs text-slate-400">Every message this person has received, newest first.</p>
              <ol className="space-y-2">
                {history.map((m) => {
                  const current = m.id === message.id;
                  return (
                    <li key={m.id}>
                      <Link href={`/console/messages/${m.id}`} className={`block rounded-lg border px-3 py-2 ${current ? "border-brand-300 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-slate-800">{m.subject ?? m.triggerType?.replace(/_/g, " ") ?? "Message"}</span>
                          <span className="shrink-0 text-[11px] text-slate-400">{fmt(m.sentAt)}</span>
                        </div>
                        <div className="truncate text-xs text-slate-500">{m.body}</div>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
