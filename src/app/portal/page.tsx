import Link from "next/link";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { mintConsoleTicket } from "@/lib/auth";
import { NOTICE_DAYS } from "@/lib/domain/availability";

export const dynamic = "force-dynamic";

export default async function PortalHome() {
  const session = await requireUser();
  const ticket = await mintConsoleTicket();

  // The logged-in adult, plus any dependents they manage.
  const me = session.personId
    ? await prisma.person.findUnique({
        where: { id: session.personId },
        include: { dependents: true },
      })
    : null;

  const peopleIds = [
    ...(me ? [me.id] : []),
    ...(me?.dependents.map((d) => d.id) ?? []),
  ];

  const registrations = peopleIds.length
    ? await prisma.registration.findMany({
        where: { personId: { in: peopleIds } },
        include: {
          person: true,
          division: true,
        },
        orderBy: { submittedAt: "desc" },
      })
    : [];

  const memberships = peopleIds.length
    ? await prisma.teamMember.findMany({
        where: { personId: { in: peopleIds } },
        include: {
          team: { include: { coach: { include: { person: true } }, facility: true } },
          person: true,
        },
      })
    : [];

  const payments = peopleIds.length
    ? await prisma.payment.findMany({
        where: { partyId: { in: peopleIds }, direction: "IN" },
        orderBy: { createdAt: "desc" },
      })
    : [];

  // Upcoming league fixtures for the household's teams (§14 — 7-day notice + 48h).
  const teamIds = memberships.map((m) => m.teamId);
  const now = new Date();
  const horizon = new Date(now.getTime() + NOTICE_DAYS * 24 * 60 * 60 * 1000);
  const fixtures = teamIds.length
    ? await prisma.fixture.findMany({
        where: {
          status: { in: ["SCHEDULED", "CONFIRMED", "RESCHEDULED"] },
          scheduledAt: { gte: new Date(now.getTime() - 6 * 60 * 60 * 1000), lte: horizon },
          OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }],
        },
        include: {
          homeTeam: true, awayTeam: true, facility: true,
          confirmations: { where: { personId: { in: peopleIds } } },
        },
        orderBy: { scheduledAt: "asc" },
      })
    : [];

  // Which household member is on each fixture's team?
  const memberByTeam = new Map(memberships.map((m) => [m.teamId, m.person]));

  const inbox = peopleIds.length
    ? await prisma.messageRecipient.findMany({
        where: { personId: { in: peopleIds } },
        include: { message: true },
        orderBy: { message: { sentAt: "desc" } },
        take: 20,
      })
    : [];
  const unread = inbox.filter((r) => !r.readAt).length;

  const waiverOutstanding = me && !me.waiverSignedAt;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {session.name.split(" ")[0]}</h1>
        <p className="text-slate-500">Your season at a glance.</p>
      </div>

      {waiverOutstanding && (
        <div className="card border-l-4 border-amber-400">
          <p className="text-sm font-medium text-amber-800">Waiver outstanding</p>
          <p className="mt-1 text-sm text-slate-600">
            A signed waiver is required before appearing on a court-ready roster.
          </p>
        </div>
      )}

      {/* Announcements / inbox */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Announcements
          {unread > 0 && <span className="badge bg-brand-100 text-brand-800">{unread} new</span>}
        </h2>
        {inbox.length === 0 ? (
          <div className="card text-sm text-slate-500">No messages yet.</div>
        ) : (
          <div className="space-y-2">
            {inbox.map((r) => (
              <div key={r.id} className={`card ${!r.readAt ? "border-l-4 border-brand-400" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-800">{r.message.subject ?? "Message from PURE Academy"}</div>
                    <p className="mt-1 text-sm text-slate-600">{r.message.body}</p>
                    <div className="mt-1 text-xs text-slate-400">
                      {r.message.sentAt.toLocaleDateString()} · {r.message.channels.replace(/,/g, ", ")}
                    </div>
                  </div>
                  {!r.readAt && (
                    <form method="POST" action="/api/portal">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="markMessageRead" />
                      <input type="hidden" name="recipientId" value={r.id} />
                      <button className="btn-ghost text-xs whitespace-nowrap">Mark read</button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Placement / registration status */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Registrations</h2>
        <div className="space-y-3">
          {registrations.length === 0 && (
            <div className="card text-sm text-slate-500">
              No registrations yet.{" "}
              <Link href="/register" className="font-medium text-brand-700">Register for the season →</Link>
            </div>
          )}
          {registrations.map((r) => (
            <div key={r.id} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-800">{r.person.firstName} {r.person.lastName}</div>
                  <div className="text-sm text-slate-500">
                    {r.division?.name ?? "Awaiting placement"}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>
              {r.status !== "ASSIGNED" && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  You&apos;ll be placed on a team after the Week-1 assessment. We&apos;ll notify
                  you with your team, coach, location, day, and time — then request payment.
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Teams */}
      {memberships.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">My teams</h2>
          <div className="space-y-3">
            {memberships.map((m) => (
              <div key={m.id} className="card">
                <div className="font-semibold text-slate-800">{m.team.name}</div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-600">
                  <div><dt className="text-xs text-slate-400">Coach</dt><dd>{m.team.coach ? `${m.team.coach.person.firstName} ${m.team.coach.person.lastName}` : "TBA"}</dd></div>
                  <div><dt className="text-xs text-slate-400">Location</dt><dd>{m.team.facility?.name ?? "TBA"}</dd></div>
                  <div><dt className="text-xs text-slate-400">Day / time</dt><dd>{m.team.dayOfWeek ?? "TBA"} {m.team.startTime ?? ""}</dd></div>
                  <div><dt className="text-xs text-slate-400">Player</dt><dd>{m.person.firstName}</dd></div>
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Upcoming matches — availability confirmation (§14) */}
      {fixtures.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Upcoming matches</h2>
          <div className="space-y-3">
            {fixtures.map((f) => {
              const myTeamId = teamIds.find((id) => id === f.homeTeamId || id === f.awayTeamId)!;
              const person = memberByTeam.get(myTeamId);
              if (!person) return null;
              const current = f.confirmations.find((c) => c.personId === person.id)?.status ?? "UNCONFIRMED";
              const hoursOut = Math.round((f.scheduledAt.getTime() - now.getTime()) / 3.6e6);
              return (
                <div key={f.id} className="card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-slate-800">
                        {f.homeTeam?.name} <span className="text-slate-400">vs</span> {f.awayTeam?.name}
                      </div>
                      <div className="text-xs text-slate-400">
                        {f.scheduledAt.toLocaleDateString()} · {f.facility?.name ?? "hub TBD"} · {person.firstName}
                        {hoursOut <= 48 && hoursOut > 0 && <span className="ml-2 text-amber-600">confirm within {hoursOut}h</span>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {["PLAYING", "NOT_PLAYING"].map((opt) => (
                        <form key={opt} method="POST" action="/api/portal">
                          <input type="hidden" name="ticket" value={ticket} />
                          <input type="hidden" name="op" value="confirmAvailability" />
                          <input type="hidden" name="fixtureId" value={f.id} />
                          <input type="hidden" name="personId" value={person.id} />
                          <input type="hidden" name="status" value={opt} />
                          <button
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                              current === opt
                                ? opt === "PLAYING" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                          >
                            {opt === "PLAYING" ? "Playing" : "Not playing"}
                          </button>
                        </form>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Payments */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Payments</h2>
        <div className="space-y-3">
          {payments.length === 0 ? (
            <div className="card text-sm text-slate-500">No payments requested yet.</div>
          ) : (
            payments.map((p) => (
              <div key={p.id} className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-800">{formatCents(p.amountCents)}</div>
                    <div className="text-xs text-slate-400">
                      {p.description ?? p.category.replace(/_/g, " ")}
                      {p.installmentPlan ? " · monthly plan" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={p.status} />
                    {(p.status === "REQUESTED" || p.status === "PENDING") && (
                      <form method="POST" action="/api/portal" className="flex flex-wrap items-center justify-end gap-2">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="startCheckout" />
                        <input type="hidden" name="paymentId" value={p.id} />
                        <button name="plan" value="full" className="btn-primary">Pay in full</button>
                        <button name="plan" value="installments" className="btn-secondary">
                          3 payments of {formatCents(Math.round(p.amountCents / 3))}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
                {(p.status === "REQUESTED" || p.status === "PENDING") && (
                  <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    The season fee reserves a place on a team, not a session count. There are
                    no make-ups: individual practices PURE cancels are not refunded or credited.
                    Choose <span className="font-medium">pay in full</span>, or the{" "}
                    <span className="font-medium">3-payment plan</span> — 3 equal charges billed
                    automatically at the end of each of your first three training months (nothing
                    charged today). Secure checkout is hosted by Stripe — we never see your card details.
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
