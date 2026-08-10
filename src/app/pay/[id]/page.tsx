import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { ACADEMY_LOGO, PADEL_LOGO, splitInstallments, INSTALLMENT_COUNT, SUPPORT_ADDRESS } from "@/lib/payments/receipt";

export const dynamic = "force-dynamic";

// PUBLIC pay page — reachable from the fee-request email with no login. The
// payment id in the URL is the capability token, so a parent without an account
// can pay. We surface only the fee description + amount, nothing account-linked.
export default async function PublicPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ plan?: string; canceled?: string; err?: string }>;
}) {
  const { id } = await params;
  const { plan, canceled, err } = await searchParams;

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { party: true },
  });

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
        ) : (
          <PayCard payment={payment!} plan={plan} canceled={canceled} err={err} />
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          Questions? Contact us at{" "}
          <a href={`mailto:${SUPPORT_ADDRESS}`} className="text-brand-600 underline">{SUPPORT_ADDRESS}</a>.
        </p>
      </div>
    </div>
  );
}

function PayCard({
  payment,
  plan,
  canceled,
  err,
}: {
  payment: { id: string; amountCents: number; description: string | null; party: { firstName: string } | null };
  plan?: string;
  canceled?: string;
  err?: string;
}) {
  const per = formatCents(splitInstallments(payment.amountCents)[1]);
  const recommendInstall = plan === "installments";
  const forWho = payment.party?.firstName ? ` for ${payment.party.firstName}` : "";

  return (
    <div className="card">
      <h1 className="text-2xl font-bold text-slate-900">Pay your season fee{forWho}</h1>
      <p className="mt-1 text-sm text-slate-500">{payment.description ?? "PURE Academy season fee"}</p>

      {canceled && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Checkout was canceled — no charge was made. You can try again below.
        </p>
      )}
      {err === "notfound" && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          We couldn&apos;t start checkout. Please try again.
        </p>
      )}

      <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
        <span className="text-sm font-medium text-slate-600">Amount due</span>
        <span className="text-2xl font-bold text-slate-900">{formatCents(payment.amountCents)}</span>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Choose how you&apos;d like to pay. Secure checkout is hosted by Stripe — we never see your
        card details. No account or login required.
      </p>

      <form method="POST" action="/api/pay" className="mt-5 space-y-3">
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
            Pay in {INSTALLMENT_COUNT} — {per} per month
          </span>
          <span className="block text-xs text-slate-500">
            {INSTALLMENT_COUNT} equal charges billed automatically at the end of each of your first
            three training months. Nothing is charged today.
          </span>
        </button>
      </form>
    </div>
  );
}
