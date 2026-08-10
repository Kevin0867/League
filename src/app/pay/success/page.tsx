import { ACADEMY_LOGO, PADEL_LOGO, SUPPORT_EMAIL } from "@/lib/payments/receipt";

export const dynamic = "force-dynamic";

// PUBLIC payment success — where Stripe (or the simulated checkout) returns the
// payer. No login required; the webhook records the actual PAID status.
export default async function PaySuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ sim?: string }>;
}) {
  const { sim } = await searchParams;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ACADEMY_LOGO} alt="PURE Academy" className="h-9 w-auto rounded-md" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PADEL_LOGO} alt="PURE Pickleball & Padel" className="h-10 w-auto" />
        </div>
        <div className="card text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl">✓</div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Thank you — you&apos;re all set!</h1>
          <p className="mt-2 text-slate-500">
            Your season fee is confirmed. We&apos;ll email your receipt and follow up with team,
            coach, and practice details.
          </p>
          {sim === "1" && (
            <p className="mt-3 text-xs text-slate-400">(Test mode — no real charge was made.)</p>
          )}
          <p className="mt-6 text-xs text-slate-400">
            Questions? Contact us at{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand-600 underline">{SUPPORT_EMAIL}</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
