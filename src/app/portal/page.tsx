import Link from "next/link";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { mintConsoleTicket } from "@/lib/auth";
import { NOTICE_DAYS } from "@/lib/domain/availability";
import { MessageFrame } from "@/components/MessageFrame";
import { formatTime12, formatDate, formatStamp } from "@/lib/time";
import { Notice } from "@/components/Notice";
import { PayButtons } from "./PayButtons";
import { installmentChargeDates } from "@/lib/payments/receipt";

const PAY_ERRORS: Record<string, { title: string; detail: string }> = {
  notfound: { title: "We couldn't find that invoice", detail: "The payment link may be out of date. Refresh the page and try again, or contact us if it persists." },
  auth: { title: "That invoice isn't on your account", detail: "You can only pay invoices for your own household. Please contact us if you think this is a mistake." },
  stripe: { title: "Checkout couldn't start", detail: "Our payment provider didn't respond. No charge was made. Please try again in a moment — if it keeps happening, contact us and we'll help." },
};

export const dynamic = "force-dynamic";

export default async function PortalHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
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
        include: { person: true, division: true },
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
  // Outstanding fees drive a top-of-page call to action; the rest is history.
  const outstandingPayments = payments.filter((p) => p.status === "REQUESTED" || p.status === "PENDING");
  const failedPayments = payments.filter((p) => p.status === "FAILED");
  const paymentHistory = payments.filter((p) => !["REQUESTED", "PENDING", "FAILED"].includes(p.status));
  const totalOutstanding = outstandingPayments.reduce((s, p) => s + p.amountCents, 0);
  const totalPaid = paymentHistory.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amountCents, 0);
  // Match a payment-request announcement to the person's outstanding fee so the
  // announcement itself is clickable to pay.
  const outstandingByPerson = new Map(outstandingPayments.filter((p) => p.partyId).map((p) => [p.partyId as string, p]));

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
        // Only in-app announcements belong in the portal inbox; email-only
        // sends (e.g. fee-request resends) deliver by email without cluttering it.
        where: { personId: { in: peopleIds }, message: { channels: { contains: "IN_APP" } } },
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

      {sp.payerr && PAY_ERRORS[sp.payerr] && (
        <Notice kind="error" title={PAY_ERRORS[sp.payerr].title}>{PAY_ERRORS[sp.payerr].detail}</Notice>
      )}
      {sp.paid && <Notice kind="success" title="You're all set">This fee is already paid — thank you!</Notice>}
      {failedPayments.length > 0 && (
        <Notice kind="error" title="A payment didn't go through">
          Your last payment attempt was unsuccessful (often an expired card or a bank decline). No place is lost — please try again below. If it keeps failing, contact us and we&apos;ll sort it out.
        </Notice>
      )}

      {/* Balance summary — one clear figure for the household */}
      {outstandingPayments.length > 0 && (
        <div className="card border-l-4 border-brand-500">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Balance due</div>
              <div className="text-3xl font-extrabold text-slate-900">{formatCents(totalOutstanding)}</div>
              {totalPaid > 0 && <div className="mt-0.5 text-xs text-slate-400">{formatCents(totalPaid)} paid so far</div>}
            </div>
          </div>
        </div>
      )}

      {waiverOutstanding && (
        <div className="card border-l-4 border-amber-400">
          <p className="text-sm font-medium text-amber-800">Waiver outstanding</p>
          <p className="mt-1 text-sm text-slate-600">
            A signed waiver is required before appearing on a court-ready roster.
          </p>
        </div>
      )}

      {/* ── Pinned to the top: Payments, Registrations, Teams ── */}

      {/* Outstanding season fees — top-of-page call to action */}
      {outstandingPayments.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            {outstandingPayments.length > 1 ? "Season fees due" : "Season fee due"}
          </h2>
          <div className="space-y-3">
            {outstandingPayments.map((p) => (
              <div key={p.id} className="card border-l-4 border-brand-500 ring-1 ring-brand-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-bold text-slate-900">{formatCents(p.amountCents)}</div>
                    <div className="text-xs text-slate-500">
                      {p.description ?? p.category.replace(/_/g, " ")}
                      {p.installmentPlan ? " · 3-payment plan" : ""}
                    </div>
                  </div>
                  <PayButtons ticket={ticket} paymentId={p.id} amountCents={p.amountCents} />
                </div>
                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  <p>
                    The season fee reserves a place on a team, not a session count. Choose{" "}
                    <span className="font-medium">pay in full</span>, or the{" "}
                    <span className="font-medium">3-payment plan</span>. Secure checkout is hosted by Stripe —
                    we never see your card details.
                  </p>
                  <p className="mt-1.5">
                    <span className="font-medium">3-payment plan:</span>{" "}
                    {installmentChargeDates(new Date()).map((d, i) => (
                      <span key={i}>
                        {i > 0 ? " · " : ""}
                        {formatCents(Math.round(p.amountCents / 3))} on {i === 0 ? "today" : formatStamp(d)}
                      </span>
                    ))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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
                  <div className="text-sm text-slate-500">{r.division?.name ?? "Awaiting placement"}</div>
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
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-800">{m.team.name}</div>
                  <Link href={`/portal/team/${m.teamId}`} className="text-sm font-medium text-brand-700 hover:underline">
                    View team →
                  </Link>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-600">
                  <div><dt className="text-xs text-slate-400">Coach</dt><dd>{m.team.coach ? `${m.team.coach.person.firstName} ${m.team.coach.person.lastName}` : "TBA"}</dd></div>
                  <div><dt className="text-xs text-slate-400">Location</dt><dd>{m.team.facility?.name ?? "TBA"}</dd></div>
                  <div><dt className="text-xs text-slate-400">Day / time</dt><dd>{m.team.dayOfWeek ?? "TBA"} {formatTime12(m.team.startTime)}</dd></div>
                  <div><dt className="text-xs text-slate-400">Player</dt><dd>{m.person.firstName}</dd></div>
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Announcements ── */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Announcements
            {unread > 0 && <span className="badge bg-brand-100 text-brand-800">{unread} new</span>}
          </h2>
          {inbox.length > 0 && (
            <div className="flex items-center gap-3">
              {unread > 0 && (
                <form method="POST" action="/api/portal">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="markAllMessagesRead" />
                  <button className="text-xs font-medium text-brand-700 hover:underline">Mark all read</button>
                </form>
              )}
              {inbox.some((r) => r.readAt) && (
                <form method="POST" action="/api/portal">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="clearReadMessages" />
                  <button className="text-xs font-medium text-slate-500 hover:underline">Clear read</button>
                </form>
              )}
            </div>
          )}
        </div>
        {inbox.length === 0 ? (
          <div className="card text-sm text-slate-500">No messages yet.</div>
        ) : (
          <div className="space-y-2">
            {inbox.map((r) => {
              const pay = r.message.triggerType === "PAYMENT_REQUEST" && r.message.audienceRef
                ? outstandingByPerson.get(r.message.audienceRef)
                : null;
              return (
                <div key={r.id} className={`card ${!r.readAt ? "border-l-4 border-brand-400" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800">{r.message.subject ?? "Message from PURE Academy"}</div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {formatDate(r.message.sentAt)} · {r.message.channels.replace(/,/g, ", ")}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <form method="POST" action="/api/portal">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value={r.readAt ? "markMessageUnread" : "markMessageRead"} />
                        <input type="hidden" name="recipientId" value={r.id} />
                        <button className="btn-ghost text-xs whitespace-nowrap">{r.readAt ? "Mark unread" : "Mark read"}</button>
                      </form>
                      <form method="POST" action="/api/portal">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="deleteMessage" />
                        <input type="hidden" name="recipientId" value={r.id} />
                        <button className="text-xs font-medium text-rose-600 hover:underline">Delete</button>
                      </form>
                    </div>
                  </div>

                  {/* A payment-due announcement is clickable straight to checkout. */}
                  {pay && (
                    <Link href={`/pay/${pay.id}`} className="btn-primary mt-3 inline-flex text-sm">
                      Pay {formatCents(pay.amountCents)} now →
                    </Link>
                  )}

                  {/* Replicate the emailed notification in HTML when we have it. */}
                  {r.message.html ? (
                    <div className="mt-3">
                      <MessageFrame html={r.message.html} />
                    </div>
                  ) : (
                    <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{r.message.body}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

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
                        {formatDate(f.scheduledAt)} · {f.facility?.name ?? "hub TBD"} · {person.firstName}
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

      {/* Payment history (paid / refunded) */}
      {paymentHistory.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Payment history</h2>
          <div className="space-y-3">
            {paymentHistory.map((p) => (
              <div key={p.id} className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-800">{formatCents(p.amountCents)}</div>
                    <div className="text-xs text-slate-400">
                      {p.description ?? p.category.replace(/_/g, " ")}
                      {p.installmentPlan ? " · monthly plan" : ""}
                    </div>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
