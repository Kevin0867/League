import Link from "next/link";

export default function PaymentCancel() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-slate-100 text-3xl">↩</div>
      <h1 className="mt-6 text-2xl font-bold text-slate-900">Checkout cancelled</h1>
      <p className="mt-2 text-slate-600">
        No charge was made. Your place is still reserved — you can pay any time from your portal.
      </p>
      <Link href="/portal" className="btn-primary mt-6">Back to my portal</Link>
    </div>
  );
}
