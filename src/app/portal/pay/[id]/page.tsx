import Link from "next/link";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { ACADEMY_LOGO, PADEL_LOGO, splitInstallments, INSTALLMENT_COUNT } from "@/lib/payments/receipt";
import { SeasonFeePayForm } from "@/app/pay/[id]/SeasonFeePayForm";

export const dynamic = "force-dynamic";

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ plan?: string }>;
}) {
  const { id } = await params;
  const { plan } = await searchParams;
  const session = await requireUser();
  const ticket = await mintConsoleTicket();

  // Household this user may pay for: themselves + dependents.
  const me = session.personId
    ? await prisma.person.findUnique({
        where: { id: session.personId },
        include: { dependents: { select: { id: true } } },
      })
    : null;
  const household = me ? [me.id, ...me.dependents.map((d) => d.id)] : [];

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { party: true, season: true },
  });

  const notAllowed =
    !payment ||
    payment.direction !== "IN" ||
    !payment.partyId ||
    !household.includes(payment.partyId);

  if (notAllowed) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <h1 className="text-xl font-bold text-slate-900">Payment not found</h1>
        <p className="mt-2 text-slate-500">This payment link isn&apos;t available on your account.</p>
        <Link href="/portal" className="btn-primary mt-6">Back to my portal</Link>
      </div>
    );
  }

  if (payment.status === "PAID") {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl">✓</div>
        <h1 className="mt-4 text-xl font-bold text-slate-900">You&apos;re all set</h1>
        <p className="mt-2 text-slate-500">This fee has already been paid. Thank you!</p>
        <Link href="/portal" className="btn-primary mt-6">Back to my portal</Link>
      </div>
    );
  }

  const per = formatCents(splitInstallments(payment.amountCents)[1]);
  const recommendInstall = plan === "installments";
  const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
  const shirtCents = rate?.shirtPriceCents ?? 2500;
  const tankCents = rate?.tankPriceCents ?? 2500;
  const needsApparel = payment.category === "PLAYER_FEE";

  return (
    <div className="mx-auto max-w-lg py-8">
      {/* Brand header: PURE Academy (left) + PURE Pickleball & Padel (right) */}
      <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ACADEMY_LOGO} alt="PURE Academy" className="h-9 w-auto rounded-md" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PADEL_LOGO} alt="PURE Pickleball & Padel" className="h-10 w-auto" />
      </div>

      <div className="card">
        <h1 className="text-2xl font-bold text-slate-900">Pay your season fee</h1>
        <p className="mt-1 text-sm text-slate-500">{payment.description ?? "PURE Academy season fee"}</p>

        <p className="mt-2 text-xs text-slate-500">
          Secure checkout is hosted by Stripe — we never see your card details. The fee reserves a place on a
          team, not a session count.
        </p>

        {needsApparel ? (
          <div className="mt-4">
            <SeasonFeePayForm
              paymentId={payment.id}
              seasonFeeCents={payment.amountCents}
              shirtCents={shirtCents}
              tankCents={tankCents}
              recommendInstall={recommendInstall}
              perInstallmentCents={splitInstallments(payment.amountCents)[1]}
              installmentCount={INSTALLMENT_COUNT}
              action="/api/portal"
              extraFields={{ ticket, op: "startCheckout" }}
            />
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
              <span className="text-sm font-medium text-slate-600">Amount due</span>
              <span className="text-2xl font-bold text-slate-900">{formatCents(payment.amountCents)}</span>
            </div>
            <form method="POST" action="/api/portal" className="mt-5 space-y-3">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="startCheckout" />
              <input type="hidden" name="paymentId" value={payment.id} />
              <button
                name="plan" value="full"
                className={`w-full rounded-xl border px-4 py-3 text-left ${
                  recommendInstall ? "border-slate-200 bg-white hover:border-slate-300" : "border-brand-500 bg-brand-50 ring-1 ring-brand-500"
                }`}
              >
                <span className="block font-semibold text-slate-900">Pay in full — {formatCents(payment.amountCents)}</span>
                <span className="block text-xs text-slate-500">One secure payment now.</span>
              </button>
              <button
                name="plan" value="installments"
                className={`w-full rounded-xl border px-4 py-3 text-left ${
                  recommendInstall ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="block font-semibold text-slate-900">
                  Pay in {INSTALLMENT_COUNT} — {per} today, then 2 more
                </span>
                <span className="block text-xs text-slate-500">
                  {per} charged today, then two more every 30 days ({INSTALLMENT_COUNT} equal payments).
                </span>
              </button>
            </form>
          </>
        )}

        <Link href="/portal" className="mt-5 inline-block text-sm text-slate-400 hover:underline">
          ← Back to my portal
        </Link>
      </div>
    </div>
  );
}
