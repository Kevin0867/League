import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { formatCents } from "@/lib/money";
import { ACADEMY_LOGO, PADEL_LOGO, splitInstallments, INSTALLMENT_COUNT, SUPPORT_ADDRESS } from "@/lib/payments/receipt";
import { SeasonFeePayForm } from "./SeasonFeePayForm";

export const dynamic = "force-dynamic";

// PUBLIC pay page — reachable from the fee-request email with no login. The
// payment id in the URL is the capability token, so a parent without an account
// can pay. We surface only the fee description + amount, nothing account-linked.
export default async function PublicPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ plan?: string; canceled?: string; err?: string; test?: string; heard?: string }>;
}) {
  const { id } = await params;
  const { plan, canceled, err, test, heard } = await searchParams;

  // Admin test mode (?test=1): an admin can click all the way through with no
  // real charge. Never available to a public payer.
  const session = await getSession();
  const testMode = test === "1" && !!session && can((session.roles ?? [session.role]) as never, "manageTeams");

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { party: true },
  });

  // Apparel prices for the season-fee picker.
  const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
  const shirtCents = rate?.shirtPriceCents ?? 2500;
  const tankCents = rate?.tankPriceCents ?? 2500;

  // Players this invoice covers — so apparel can be tagged per child on a family
  // invoice. coveredPersonIds lists the kids; otherwise it's the single payer.
  const coveredIds = payment
    ? Array.isArray(payment.coveredPersonIds)
      ? (payment.coveredPersonIds as string[])
      : payment.partyId
      ? [payment.partyId]
      : []
    : [];
  const players = coveredIds.length
    ? (await prisma.person.findMany({ where: { id: { in: coveredIds } }, select: { id: true, firstName: true, lastName: true } })).map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
      }))
    : [];

  const invalid = !payment || payment.direction !== "IN";

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-lg">
        {/* Co-branded header */}
        <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ACADEMY_LOGO} alt="PURE Academy" className="h-9 w-auto rounded-md" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PADEL_LOGO} alt="PURE Pickleball & Padel" className="h-10 w-auto" />
        </div>

        {invalid ? (
          <div className="card text-center">
            <h1 className="text-xl font-bold text-slate-900">Payment link not found</h1>
            <p className="mt-2 text-slate-500">
              This payment link isn&apos;t valid. Please check the most recent email, or contact us at{" "}
              <a href={`mailto:${SUPPORT_ADDRESS}`} className="text-brand-600 underline">{SUPPORT_ADDRESS}</a>.
            </p>
          </div>
        ) : payment!.status === "PAID" ? (
          <div className="card text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl">✓</div>
            <h1 className="mt-4 text-xl font-bold text-slate-900">You&apos;re all set</h1>
            <p className="mt-2 text-slate-500">This fee has already been paid. Thank you!</p>
          </div>
        ) : payment!.category === "ALA_CARTE" ? (
          <OneOffPayCard payment={payment!} title="Confirm your spot" fallbackDesc="PURE Academy clinic" canceled={canceled} err={err} />
        ) : payment!.category === "CUSTOM" || payment!.category === "ACP_ENTRY" ? (
          <OneOffPayCard payment={payment!} title="Complete your payment" fallbackDesc="PURE Academy payment" canceled={canceled} err={err} />
        ) : payment!.category === "APPAREL" ? (
          <ApparelOrderCard payment={payment!} canceled={canceled} err={err} shirtCents={shirtCents} tankCents={tankCents} players={players} testMode={testMode} />
        ) : (
          <PayCard payment={payment!} plan={plan} canceled={canceled} err={err} shirtCents={shirtCents} tankCents={tankCents} players={players} testMode={testMode} />
        )}

        {/* Can't pay by the deadline? Let the family tell us why in one tap — it
            routes to staff for a personal follow-up. Only while still unpaid. */}
        {!invalid && payment!.status !== "PAID" && payment!.category !== "APPAREL" && (
          heard === "1" ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center text-sm text-emerald-800">
              <div className="mx-auto mb-1 grid h-8 w-8 place-items-center rounded-full bg-emerald-100">✓</div>
              Thank you — we&apos;ve got it and someone from PURE will reach out. You can still pay anytime using the link above.
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              {payment!.category === "PLAYER_FEE" && (
                <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">
                  <span className="font-semibold">Want to spread it out?</span> You can split your dues into <strong>3 monthly payments</strong> — just choose <strong>&ldquo;Pay in 3&rdquo;</strong> above. No approval needed.
                </div>
              )}
              <p className="text-sm font-semibold text-slate-800">Still can&apos;t pay by the deadline?</p>
              <p className="mt-0.5 text-xs text-slate-500">Tell us why in one tap — we&apos;ll reach out to help. No payment needed to send this.</p>
              <form method="POST" action="/api/pay/reason" className="mt-3 space-y-2">
                <input type="hidden" name="paymentId" value={payment!.id} />
                <div className="grid gap-1.5">
                  {[
                    ["PAYMENT_PLAN", "I need more time or a different arrangement"],
                    ["HARDSHIP", "Financial hardship"],
                    ["TEAM_QUESTION", "I have a question about my team/placement"],
                    ["NOT_PLAYING", "We&#39;re not playing this season"],
                    ["OTHER", "Something else"],
                  ].map(([val, label]) => (
                    <label key={val} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:border-brand-300 hover:bg-brand-50/40">
                      <input type="radio" name="reason" value={val} required className="h-4 w-4" />
                      <span dangerouslySetInnerHTML={{ __html: label }} />
                    </label>
                  ))}
                </div>
                <textarea name="note" rows={2} placeholder="Add anything you'd like us to know (optional)…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
                <button className="btn-secondary w-full text-sm">Send to PURE</button>
              </form>
            </div>
          )
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          Questions? Contact us at{" "}
          <a href={`mailto:${SUPPORT_ADDRESS}`} className="text-brand-600 underline">{SUPPORT_ADDRESS}</a>.
        </p>
      </div>
    </div>
  );
}

// Clinics, private lessons, and admin-created custom/ACP charges: a single
// one-time payment, no installment option.
function OneOffPayCard({
  payment,
  title,
  fallbackDesc,
  canceled,
  err,
}: {
  payment: { id: string; amountCents: number; description: string | null; party: { firstName: string } | null };
  title: string;
  fallbackDesc: string;
  canceled?: string;
  err?: string;
}) {
  return (
    <div className="card">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{payment.description ?? fallbackDesc}</p>

      {canceled && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Checkout was canceled — no charge was made. Your spot isn&apos;t confirmed until payment clears; you can try again below.
        </p>
      )}
      {err === "notfound" && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          We couldn&apos;t start checkout — this payment link may be out of date. No charge was made. Please
          use the most recent email, or contact us and we&apos;ll help.
        </p>
      )}
      {err === "stripe" && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Our payment provider didn&apos;t respond, so checkout couldn&apos;t start. <strong>No charge was made.</strong>{" "}
          Please try again in a moment — if it keeps happening, contact us.
        </p>
      )}

      <div className="mt-4 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-3">
          <span className="text-sm font-medium text-slate-500">For</span>
          <span className="text-right text-sm font-medium text-slate-800">{payment.description ?? fallbackDesc}</span>
        </div>
        <div className="flex items-center justify-between pt-3">
          <span className="text-sm font-medium text-slate-600">Amount due</span>
          <span className="text-2xl font-bold text-slate-900">{formatCents(payment.amountCents)}</span>
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Secure checkout is hosted by Stripe — we never see your card details. No account or login required.
      </p>

      <form method="POST" action="/api/pay" className="mt-5">
        <input type="hidden" name="paymentId" value={payment.id} />
        <input type="hidden" name="plan" value="full" />
        <button className="btn-primary w-full py-3 text-base">Pay {formatCents(payment.amountCents)} now</button>
      </form>
    </div>
  );
}

// Standalone team-apparel order — no season fee. Reuses the apparel picker in
// "apparel-only" mode: the apparel items are the whole charge.
function ApparelOrderCard({
  payment,
  canceled,
  err,
  shirtCents,
  tankCents,
  players,
  testMode,
}: {
  payment: { id: string; amountCents: number; description: string | null; party: { firstName: string } | null };
  canceled?: string;
  err?: string;
  shirtCents: number;
  tankCents: number;
  players: { id: string; name: string }[];
  testMode: boolean;
}) {
  const forWho = payment.party?.firstName ? ` for ${payment.party.firstName}` : "";
  return (
    <div className="card">
      <h1 className="text-2xl font-bold text-slate-900">Order team apparel{forWho}</h1>
      <p className="mt-1 text-sm text-slate-500">{payment.description ?? "PURE Academy team apparel"}</p>

      {testMode && (
        <p className="mt-3 rounded-lg border border-dashed border-indigo-300 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          <strong>Admin test mode.</strong> Completing checkout records the apparel order <em>without any real charge</em>.
        </p>
      )}
      {canceled && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Checkout was canceled — no charge was made. You can try again below.
        </p>
      )}
      {err === "apparel" && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Please add at least one team T-shirt or tank top to your order before checking out.
        </p>
      )}
      {err === "stripe" && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Our payment provider didn&apos;t respond, so checkout couldn&apos;t start. <strong>No charge was made.</strong> Please try again in a moment.
        </p>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Secure checkout is hosted by Stripe — we never see your card details. No account or login required.
      </p>

      <div className="mt-4">
        <SeasonFeePayForm
          paymentId={payment.id}
          seasonFeeCents={0}
          shirtCents={shirtCents}
          tankCents={tankCents}
          recommendInstall={false}
          perInstallmentCents={0}
          installmentCount={0}
          players={players}
          apparelOnly
          extraFields={testMode ? { test: "1" } : undefined}
        />
      </div>
    </div>
  );
}

function PayCard({
  payment,
  plan,
  canceled,
  err,
  shirtCents,
  tankCents,
  players,
  testMode,
}: {
  payment: { id: string; amountCents: number; description: string | null; party: { firstName: string } | null };
  plan?: string;
  canceled?: string;
  err?: string;
  shirtCents: number;
  tankCents: number;
  players: { id: string; name: string }[];
  testMode: boolean;
}) {
  const recommendInstall = plan === "installments";
  const forWho = payment.party?.firstName ? ` for ${payment.party.firstName}` : "";

  return (
    <div className="card">
      <h1 className="text-2xl font-bold text-slate-900">Pay your season fee{forWho}</h1>
      <p className="mt-1 text-sm text-slate-500">{payment.description ?? "PURE Academy season fee"}</p>

      {testMode && (
        <p className="mt-3 rounded-lg border border-dashed border-indigo-300 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          <strong>Admin test mode.</strong> Completing checkout here marks the fee paid and records the apparel
          order <em>without any real charge</em>, so you can see the whole flow.
        </p>
      )}

      {canceled && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Checkout was canceled — no charge was made. You can try again below.
        </p>
      )}
      {err === "apparel" && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Please add at least one team T-shirt or tank top to your order before checking out.
        </p>
      )}
      {err === "notfound" && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          We couldn&apos;t start checkout — this payment link may be out of date. No charge was made. Please
          use the most recent email, or contact us and we&apos;ll help.
        </p>
      )}
      {err === "stripe" && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Our payment provider didn&apos;t respond, so checkout couldn&apos;t start. <strong>No charge was made.</strong>{" "}
          Please try again in a moment — if it keeps happening, contact us.
        </p>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Secure checkout is hosted by Stripe — we never see your card details. No account or login required.
      </p>

      <div className="mt-4">
        <SeasonFeePayForm
          paymentId={payment.id}
          seasonFeeCents={payment.amountCents}
          shirtCents={shirtCents}
          tankCents={tankCents}
          recommendInstall={recommendInstall}
          perInstallmentCents={splitInstallments(payment.amountCents)[1]}
          installmentCount={INSTALLMENT_COUNT}
          players={players}
          extraFields={testMode ? { test: "1" } : undefined}
        />
      </div>
    </div>
  );
}
