import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { decryptField } from "@/lib/crypto";
import { ACADEMY_MARKETS } from "@/lib/enums";
import { formatDate, formatTime12 } from "@/lib/time";
import { CustomPaymentForm } from "@/components/CustomPaymentForm";
import { ApparelRequestForm } from "@/components/ApparelRequestForm";
import { feeStateOf } from "@/lib/domain/feeStatus";

// Short day + start time for a team, e.g. "Wed 5:00 PM", so staff can pick a
// team whose schedule works for the player when assigning/moving them.
const SHORT_DAY: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };
function teamDayTime(t: { dayOfWeek: string | null; startTime: string | null }): string | null {
  const day = t.dayOfWeek ? SHORT_DAY[t.dayOfWeek] ?? t.dayOfWeek : null;
  const time = t.startTime ? formatTime12(t.startTime) : null;
  return [day, time].filter(Boolean).join(" ") || null;
}
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { RecipientChecklist } from "@/components/RecipientChecklist";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

// Sensitive fields are encrypted at rest and only decrypted for staff here.
// A key mismatch yields a marker — show blank so we never re-save the marker.
function dec(v: string | null): string {
  if (!v) return "";
  const d = decryptField(v);
  return d === "[unable to decrypt]" ? "" : d;
}

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  edit: "Registration saved.",
  resent: "Notification resent.",
  assign: "Player assigned.",
  fee: "Season fee requested.",
  refund: "Refund started.",
  waiverSent: "Waiver request emailed.",
  sentall: "Sent — welcome, season fee + apparel, and waiver, in one combined email to the family.",
  welcomeSent: "Welcome sent.",
  feeexists: "This player's season fee was already invoiced — nothing new sent.",
  split: "Split onto its own record. This registration now has its own contact info — edit the name and details below so they're correct.",
  apparelReq: "Apparel order link created and emailed — they pick their gear and pay from the link.",
};
const ERR: Record<string, string> = {
  notassigned: "This player isn't on a team yet — assign them first.",
  nopayment: "No outstanding fee to resend.",
  fields: "Missing information.",
  noemail: "No email on file for this player — add one before sending the waiver.",
  nosplit: "This registration already has its own record — nothing to split.",
  apemail: "Enter a valid email to send the apparel order link.",
};

const STATUSES = ["SUBMITTED", "ASSIGNED", "WAITLISTED", "WITHDRAWN", "DUPLICATE"];
const GENDERS = ["", "Male", "Female"];

export default async function RegistrationDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  const reg = await prisma.registration.findUnique({
    where: { id },
    include: {
      person: { include: { guardian: true } },
      division: true,
      season: { include: { divisions: { orderBy: { name: "asc" }, select: { id: true, name: true } } } },
      locationPrefs: { orderBy: { rank: "asc" }, include: { facility: true } },
    },
  });
  if (!reg) redirect("/console/registrations?err=notfound");

  const p = reg.person;
  const guardian = p.isMinor ? p.guardian : null;
  const [teams, membership, payments, sharedRegs] = await Promise.all([
    prisma.team.findMany({ where: { seasonId: reg.seasonId }, orderBy: { name: "asc" }, select: { id: true, name: true, dayOfWeek: true, startTime: true } }),
    prisma.teamMember.findFirst({ where: { personId: p.id, team: { seasonId: reg.seasonId } }, include: { team: true } }),
    // Season fee(s) for THIS player — matched by who the fee covers (a minor is
    // billed through a guardian, so partyId alone would miss it) as well as
    // partyId for legacy single-player rows.
    prisma.payment.findMany({
      where: {
        seasonId: reg.seasonId,
        category: "PLAYER_FEE",
        OR: [{ partyId: p.id }, { coveredPersonIds: { array_contains: p.id } }],
      },
      orderBy: { createdAt: "desc" },
    }),
    // Other registrations on the SAME person record — renaming this person would
    // rename those too, so surface a "split onto its own record" fix when present.
    prisma.registration.findMany({
      where: { personId: p.id, id: { not: reg.id } },
      orderBy: { createdAt: "desc" },
      include: { division: { select: { name: true } }, season: { select: { name: true } } },
    }),
  ]);
  const paid = payments.find((x) => x.status === "PAID");
  // On the 3-payment plan, signed up and paying — distinct from an unpaid fee.
  const subscription = !paid ? payments.find((x) => feeStateOf(x) === "subscription") : undefined;
  const outstanding = !paid && !subscription ? payments.find((x) => ["REQUESTED", "PENDING"].includes(x.status)) : undefined;

  // When each thing was last sent — read from the message log (audienceRef is the
  // player or, for fee/launch, the paying guardian), so admins can see the
  // history without a schema change. Latest per trigger type.
  const audienceRefs = [p.id, ...(p.guardianId ? [p.guardianId] : [])];
  const sentMsgs = await prisma.message.findMany({
    where: { audienceRef: { in: audienceRefs }, triggerType: { in: ["TEAM_ASSIGNMENT", "PAYMENT_REQUEST", "WAIVER_REQUEST", "TEAM_LAUNCH"] } },
    orderBy: { createdAt: "desc" },
    select: { triggerType: true, createdAt: true },
  });
  const latest = (t: string) => sentMsgs.find((m) => m.triggerType === t)?.createdAt ?? null;
  const lastSent = {
    welcome: latest("TEAM_ASSIGNMENT"),
    fee: latest("PAYMENT_REQUEST"),
    waiver: latest("WAIVER_REQUEST"),
    launch: latest("TEAM_LAUNCH"),
  };
  const raw = (reg.importRaw && typeof reg.importRaw === "object" ? reg.importRaw : null) as Record<string, string> | null;

  const currentMarkets = reg.locationPrefs.map((l) => l.marketName ?? l.facility?.market ?? "").filter(Boolean);
  const marketOptions = Array.from(new Set([...ACADEMY_MARKETS, ...currentMarkets]));
  const dollars = (c: number | null | undefined) => (c != null ? (c / 100).toFixed(2) : "");

  const hidden = (
    <>
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="personId" value={p.id} />
      <input type="hidden" name="registrationId" value={reg.id} />
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/console/registrations" className="text-sm text-slate-500 hover:underline">← Registrations</Link>
          <h1 className="text-2xl font-bold text-slate-900">{p.firstName} {p.lastName}</h1>
          <p className="text-sm text-slate-500">{reg.season?.name} · <StatusBadge status={reg.status} /></p>
        </div>
      </div>

      {reg.status === "WAITLISTED" && (
        <div className="rounded-xl border-l-4 border-amber-400 bg-amber-50 px-4 py-3">
          <p className="font-semibold text-amber-900">★ On the waitlist — not placed yet.</p>
          <p className="mt-0.5 text-sm text-amber-800">
            To take {p.firstName} off the waitlist: <strong>assign a team below</strong> — that moves them to Placed. Then hit
            <strong> &ldquo;Send all&rdquo;</strong> to email the welcome, the pay link (fee + apparel), and the waiver in one go —
            or send each from the checklist below.
          </p>
        </div>
      )}
      {sp.ok && OK[sp.ok] && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{OK[sp.ok]}</p>}
      {sp.ok === "requested" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">Custom payment request created.</p>
          <p className="mt-1">
            {sp.cpunsent
              ? "Email delivery didn't complete — copy the pay link and send it directly:"
              : "We emailed a secure Stripe pay link. You can also copy it:"}
          </p>
          {sp.pid && <div className="mt-2"><CopyLinkButton path={`/pay/${sp.pid}`} label="Copy pay link" /></div>}
        </div>
      )}
      {sp.err === "cpname" && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Enter the recipient&apos;s name.</p>}
      {sp.err === "cpemail" && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Enter a valid recipient email.</p>}
      {sp.err === "cpamount" && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Enter an amount greater than $0.50.</p>}
      {sp.err && !["cpname", "cpemail", "cpamount"].includes(sp.err) && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERR[sp.err] ?? "Something went wrong."}</p>
      )}

      {/* Shared contact record — this person has more than one registration, so
          the name/email/phone here are shared with those. Split this registration
          onto its own record to give it a different name (e.g. a parent whose
          registration was saved under their child's name). */}
      {sharedRegs.length > 0 && (
        <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">⚠ Shared contact record</p>
          <p className="mt-1 text-sm text-slate-700">
            This person also has {sharedRegs.length === 1 ? "another registration" : `${sharedRegs.length} other registrations`} on the
            same contact record — {sharedRegs.map((r) => r.division?.name ?? r.programInterest ?? r.season?.name ?? "registration").join(", ")}.
            Editing the name, email, or phone below changes it on all of them. If this registration is really a different
            person (for example a parent whose registration was saved under their child&apos;s name), split it onto its own
            record first, then edit the name.
          </p>
          <div className="mt-3">
            <ConfirmSubmit
              action="/api/console/registrations"
              fields={{ ticket, op: "splitPerson", personId: p.id, registrationId: reg.id }}
              confirm={`Give this registration its own contact record, separate from ${p.firstName} ${p.lastName}'s other registration${sharedRegs.length === 1 ? "" : "s"}? You can then rename it without affecting the others.`}
              label="Split onto its own record"
              className="rounded-lg border border-amber-500 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
            />
          </div>
        </div>
      )}

      {/* Signup comments / placement requests — surfaced prominently. */}
      {reg.partnerRequests && reg.partnerRequests.trim() && (
        <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">💬 Signup comments / requests</p>
            <Link href="/console/requests" className="text-xs text-amber-700 underline">Placement requests →</Link>
          </div>
          <p className="mt-1 text-sm text-slate-700">“{reg.partnerRequests.trim()}”</p>
        </div>
      )}

      {/* Send to family — the per-registration mirror of the team launch panel:
          one combined "Send all" plus a backup button for each piece. */}
      <div className="card">
        <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-slate-900">Send all — one combined email</div>
              <p className="mt-0.5 text-xs text-slate-500">Welcome + pick apparel &amp; pay the season fee + complete the waiver, to {p.firstName}&apos;s family.{lastSent.launch ? ` Last sent ${formatDate(lastSent.launch)}.` : ""}</p>
            </div>
            <ConfirmSubmit
              action="/api/console/registrations"
              fields={{ ticket, op: "launchRegistration", personId: p.id, registrationId: reg.id }}
              confirm={`Send everything (welcome + apparel & fee + waiver) to ${p.firstName}'s family in one email?`}
              label="Send all"
              className="btn-primary text-sm"
            />
          </div>
        </div>

        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400">Or send individually (backup)</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col rounded-lg border border-slate-200 p-3">
            <div className="text-sm font-medium text-slate-800">1 · Welcome</div>
            <p className="mb-2 mt-0.5 text-xs text-slate-500">
              {membership ? `Placement email — ${membership.team.name}.` : "Generic welcome (no team yet)."}
              {lastSent.welcome ? ` Last sent ${formatDate(lastSent.welcome)}.` : ""}
            </p>
            <div className="mt-auto">
              <ConfirmSubmit
                action="/api/console/registrations"
                fields={{ ticket, op: "sendWelcome", personId: p.id, registrationId: reg.id }}
                confirm={`Send the welcome ${membership ? "/ placement " : ""}email to ${p.firstName}'s family?`}
                label="Send welcome"
                className="btn-secondary w-full text-sm"
              />
            </div>
          </div>
          <div className="flex flex-col rounded-lg border border-slate-200 p-3">
            <div className="text-sm font-medium text-slate-800">2 · Season fee + apparel</div>
            <p className="mb-2 mt-0.5 text-xs text-slate-500">
              {paid
                ? "✓ Paid in full."
                : subscription
                ? `✓ Subscription — paying in ${subscription.installmentsTotal ?? 3} (${subscription.installmentsPaid ?? 1} in).`
                : outstanding
                ? `${outstanding.status.toLowerCase()} — not yet paid.`
                : "Not requested yet."}
              {lastSent.fee ? ` Last sent ${formatDate(lastSent.fee)}.` : ""}
            </p>
            <div className="mt-auto">
              {paid ? (
                <span className="text-xs text-emerald-600">Paid — nothing to send.</span>
              ) : subscription ? (
                <span className="text-xs text-emerald-600">On the payment plan — nothing to send.</span>
              ) : outstanding ? (
                <ConfirmSubmit
                  action="/api/console/registrations"
                  fields={{ ticket, op: "resendPayment", personId: p.id, registrationId: reg.id }}
                  confirm={`Resend the season fee + apparel request to ${p.firstName}'s family?`}
                  label="Resend fee + apparel"
                  className="btn-secondary w-full text-sm"
                />
              ) : (
                <ConfirmSubmit
                  action="/api/console/registrations"
                  fields={{ ticket, op: "requestFee", personId: p.id, registrationId: reg.id }}
                  confirm={`Email the season fee + apparel request to ${p.firstName}'s family? They pick apparel on the pay page.`}
                  label="Request fee + apparel"
                  className="btn-secondary w-full text-sm"
                />
              )}
            </div>
          </div>
          <div className="flex flex-col rounded-lg border border-slate-200 p-3">
            <div className="text-sm font-medium text-slate-800">3 · Waiver</div>
            <p className="mb-2 mt-0.5 text-xs text-slate-500">
              {p.waiverSignedAt ? `✓ Signed ${formatDate(p.waiverSignedAt)}.` : "Not signed."}
              {lastSent.waiver ? ` Request last sent ${formatDate(lastSent.waiver)}.` : ""}
            </p>
            <div className="mt-auto">
              <ConfirmSubmit
                action="/api/console/registrations"
                fields={{ ticket, op: "sendWaiver", personId: p.id, registrationId: reg.id }}
                confirm={p.waiverSignedAt ? `Resend the waiver link to ${p.firstName}'s family?` : `Send the waiver request to ${p.firstName}'s family?`}
                label={p.waiverSignedAt ? "Resend waiver" : "Send waiver"}
                className="btn-secondary w-full text-sm"
              />
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">One waiver covers the whole household — signing for a child signs for the parent and every sibling at once.</p>
      </div>

      {/* Team & fee actions */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-900">Placement &amp; payments</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Team</p>
            <p className="text-sm font-medium text-slate-800">
              {membership?.team?.name ?? "Unassigned"}
              {membership?.team && teamDayTime(membership.team) ? (
                <span className="ml-2 font-normal text-slate-500">· {teamDayTime(membership.team)}</span>
              ) : null}
            </p>
            <form method="POST" action="/api/console/registrations" className="mt-2 flex gap-2">
              {hidden}
              <input type="hidden" name="op" value="assignToTeam" />
              <select name="teamId" defaultValue={membership?.teamId ?? ""} className="input py-1 text-sm">
                <option value="">— Select a team —</option>
                {teams.map((t) => {
                  const dt = teamDayTime(t);
                  return <option key={t.id} value={t.id}>{t.name}{dt ? ` · ${dt}` : ""}</option>;
                })}
              </select>
              <button className="btn-primary py-1 text-xs whitespace-nowrap">{membership ? "Move" : "Assign"}</button>
            </form>
            {membership && (
              <div className="mt-2 flex gap-3">
                <form method="POST" action="/api/console/registrations">
                  {hidden}<input type="hidden" name="op" value="unassign" />
                  <button className="text-xs text-slate-500 hover:underline">Send back to pool</button>
                </form>
                <form method="POST" action="/api/console/registrations">
                  {hidden}<input type="hidden" name="op" value="resendAssignment" />
                  <button className="text-xs text-brand-700 hover:underline">Resend assignment email</button>
                </form>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Season fee</p>
            <p className="text-sm font-medium text-slate-800">
              {paid
                ? `Paid ${formatCents(paid.amountCents)}`
                : subscription
                ? `Subscription · ${subscription.installmentsPaid ?? 1} of ${subscription.installmentsTotal ?? 3} paid`
                : outstanding
                ? `${outstanding.status.toLowerCase()} · ${formatCents(outstanding.amountCents)}`
                : "Not requested"}
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              {!outstanding && !paid && !subscription && (
                <form method="POST" action="/api/console/registrations">
                  {hidden}<input type="hidden" name="op" value="requestFee" />
                  <button className="btn-secondary py-1 text-xs">Request season fee</button>
                </form>
              )}
              {outstanding && (
                <details className="w-full">
                  <summary className="cursor-pointer text-xs font-semibold text-brand-700 hover:underline">Resend fee request…</summary>
                  <form method="POST" action="/api/console/registrations" className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
                    {hidden}<input type="hidden" name="op" value="resendPayment" />
                    <RecipientChecklist person={p} guardian={guardian} purpose="all" legend="Send reminder to" />
                    <button className="btn-secondary py-1 text-xs">Send reminder</button>
                  </form>
                </details>
              )}
              {paid && (
                <form method="POST" action="/api/console/registrations">
                  {hidden}<input type="hidden" name="op" value="refund" />
                  <button className="text-xs text-rose-600 hover:underline">Start refund</button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Request a one-off custom payment for this person — no need to detour to
          the Payments tab. Any amount + optional discount, emailed as a Stripe
          pay link. Pre-filled with this player's name and email. */}
      <div className="card">
        <h2 className="font-semibold text-slate-900">Request a custom payment</h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-500">
          Charge {p.firstName} any amount by card — a private lesson, a make-up, an ACP entry, any one-off. Add a
          discount if you like; we email a secure Stripe pay link and you can copy it here too.
        </p>
        <CustomPaymentForm
          ticket={ticket}
          returnTo={`/console/registrations/${reg.id}`}
          category="CUSTOM"
          defaults={{ name: `${p.firstName} ${p.lastName}`.trim(), email: p.email ?? "" }}
        />
      </div>

      {/* Send an apparel-only order link — for additional or replacement gear
          after the season fee is paid, or gear on its own. The family picks
          items and sees the total at checkout; no fixed amount here. */}
      <div className="card">
        <h2 className="font-semibold text-slate-900">Send an apparel order link</h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-500">
          Let {p.firstName} order team apparel on its own — extra shirts, a tank, a replacement size. They pick styles
          and sizes and pay securely; it lands on the same fulfillment report as season-fee apparel.
        </p>
        <ApparelRequestForm
          ticket={ticket}
          personId={p.id}
          returnTo={`/console/registrations/${reg.id}`}
          defaults={{ name: `${p.firstName} ${p.lastName}`.trim(), email: p.email ?? "" }}
        />
      </div>

      {/* Editable details */}
      <form method="POST" action="/api/console/registrations" className="card space-y-5">
        {hidden}
        <input type="hidden" name="op" value="editRegistration" />
        <h2 className="font-semibold text-slate-900">Player &amp; registration details</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" name="firstName" defaultValue={p.firstName} />
          <Field label="Last name" name="lastName" defaultValue={p.lastName} />
          <Field label="Email" name="email" type="email" defaultValue={p.email ?? ""} />
          <Field label="Phone" name="phone" type="tel" defaultValue={p.phone ?? ""} />
          <Field label="Date of birth" name="dob" type="date" defaultValue={p.dob ? p.dob.toISOString().slice(0, 10) : ""} />
          <Select label="Gender" name="gender" defaultValue={p.gender ?? ""} options={GENDERS.map((g) => ({ value: g, label: g || "—" }))} />
          <Field label="Address" name="address" defaultValue={dec(p.address)} />
          <Field label="How heard" name="howHeard" defaultValue={p.howHeard ?? ""} />
          <Field label="Emergency contact" name="emergencyName" defaultValue={dec(p.emergencyName)} />
          <Field label="Emergency phone" name="emergencyPhone" type="tel" defaultValue={dec(p.emergencyPhone)} />
          <div className="sm:col-span-2">
            <label className="label">Medical disclosures</label>
            <textarea name="medical" rows={2} className="input" defaultValue={dec(p.medicalNotes)} />
          </div>
        </div>

        {/* Notification emails — up to three addresses, each with a name/label,
            so staff can choose per-email who receives what (both parents, the
            player). */}
        <div className="border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-700">Notification emails</h3>
          <p className="mb-3 mt-0.5 text-xs text-slate-500">
            Both parents and the player can each get a copy. Label each address with a name so you can choose who
            receives each email — a progress report to parents, a payment reminder to just the paying parent, and so on.
          </p>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Primary email label (e.g. Mom)" name="emailLabel" defaultValue={p.emailLabel ?? ""} />
              <div className="hidden sm:block" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Additional email" name="email2" type="email" defaultValue={p.email2 ?? ""} />
              <Field label="Its label (e.g. Dad)" name="email2Label" defaultValue={p.email2Label ?? ""} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Additional email" name="email3" type="email" defaultValue={p.email3 ?? ""} />
              <Field label="Its label (e.g. Player)" name="email3Label" defaultValue={p.email3Label ?? ""} />
            </div>
          </div>
        </div>

        <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
          <Select label="Division" name="divisionId" defaultValue={reg.divisionId ?? ""}
            options={[{ value: "", label: "— Unassigned —" }, ...reg.season!.divisions.map((d) => ({ value: d.id, label: d.name }))]} />
          <Select label="Status" name="status" defaultValue={reg.status} options={STATUSES.map((s) => ({ value: s, label: s }))} />
          <Field label="Skill level" name="skillLevel" defaultValue={reg.skillLevel ?? ""} />
          <Field label="Program interest" name="programInterest" defaultValue={reg.programInterest ?? ""} />
          <Field label="Practice time pref" name="practiceTimePref" defaultValue={reg.practiceTimePref ?? ""} />
          <Field label="Schedule" name="schedule" defaultValue={reg.schedule ?? ""} />
          <Field label="Days that don't work" name="daysThatDontWork" defaultValue={reg.daysThatDontWork ?? ""} />
          <div className="sm:col-span-2">
            <label className="label">Notes / partner requests / comments</label>
            <textarea name="partnerRequests" rows={2} className="input" defaultValue={reg.partnerRequests ?? ""} />
          </div>
        </div>

        {/* Intake & preferences — editable */}
        <div className="border-t border-slate-100 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Intake &amp; preferences</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((rank) => (
              <div key={rank}>
                <label className="label">Location #{rank}</label>
                <select name={`locationPref${rank}`} defaultValue={currentMarkets[rank - 1] ?? ""} className="input">
                  <option value="">—</option>
                  {marketOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Per-class rate ($)" name="perClassRate" type="number" defaultValue={dollars(reg.perClassRateCents)} />
            <Field label="Enrollment fee ($)" name="enrollmentFee" type="number" defaultValue={dollars(reg.enrollmentFeeCents)} />
            <Field label="Source status" name="sourceStatus" defaultValue={reg.sourceStatus ?? ""} />
            <Field label="Submitted date" name="submittedAt" type="date" defaultValue={reg.submittedAt ? reg.submittedAt.toISOString().slice(0, 10) : ""} />
            <Field label="Stripe customer ID" name="stripeCustomerId" defaultValue={p.stripeCustomerId ?? ""} />
            <Field label="Stripe subscription ID" name="stripeSubscriptionId" defaultValue={reg.stripeSubscriptionId ?? ""} />
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" name="waiverSigned" defaultChecked={!!p.waiverSignedAt} />
            <span>Waiver on file{p.waiverSignedAt ? ` (signed ${formatDate(p.waiverSignedAt)})` : ""}</span>
          </label>
        </div>

        <button type="submit" className="btn-primary">Save changes</button>
      </form>

      {/* Waiver request — email a no-login signing link to the player/parent. */}
      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold text-slate-900">Participation waiver</h2>
          <p className="text-sm text-slate-500">
            {p.waiverSignedAt
              ? `On file — signed ${formatDate(p.waiverSignedAt)}.`
              : p.isMinor
                ? "Not on file. Sends a link for a parent/guardian to sign on this minor's behalf."
                : "Not on file. Sends the player a link to complete their waiver."}
          </p>
        </div>
        <form method="POST" action="/api/console/registrations" className="space-y-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="sendWaiver" />
          <input type="hidden" name="personId" value={p.id} />
          <input type="hidden" name="registrationId" value={reg.id} />
          <RecipientChecklist person={p} guardian={guardian} purpose={p.isMinor ? "report" : "all"} legend="Send the signing link to" />
          <button className="btn-secondary text-sm">
            {p.waiverSignedAt ? "Resend waiver link" : "Send waiver request"}
          </button>
        </form>
      </div>

      {raw && (
        <details className="card">
          <summary className="cursor-pointer font-semibold text-slate-900">Original enrollment data ({Object.keys(raw).length} fields)</summary>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {Object.entries(raw).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-slate-50 py-1">
                <dt className="text-slate-400">{k}</dt>
                <dd className="text-right text-slate-700">{String(v) || "—"}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {/* Danger zone — remove the registration and pull the player off any team
          in this season. Account, waiver, and payment history are preserved. */}
      <div className="card border border-rose-200">
        <h2 className="font-semibold text-rose-700">Remove registration</h2>
        <p className="mt-1 text-sm text-slate-600">
          Deletes this {reg.season?.name ?? "season"} registration and removes {p.firstName} from
          {membership?.team ? ` “${membership.team.name}.”` : " any team in this season."} Their account,
          waiver, and any payment history are kept. This can&apos;t be undone.
        </p>
        <div className="mt-3">
          <ConfirmSubmit
            action="/api/console/registrations"
            fields={{ ticket, op: "deleteRegistration", registrationId: reg.id, personId: p.id }}
            confirm={`Remove ${p.firstName} ${p.lastName}'s registration${membership?.team ? ` and take them off “${membership.team.name}”` : ""}? This can't be undone.`}
            label="Remove registration"
            className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700"
          />
        </div>
      </div>
    </div>
  );
}

function Field({ label, name, type = "text", defaultValue }: { label: string; name: string; type?: string; defaultValue?: string }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} defaultValue={defaultValue} className="input" />
    </div>
  );
}

function Select({ label, name, defaultValue, options }: { label: string; name: string; defaultValue?: string; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue} className="input">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

