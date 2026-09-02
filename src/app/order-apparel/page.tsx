import type { Metadata } from "next";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Order Team Apparel — PURE Academy" },
  description: "Order PURE Academy team T-shirts and tank tops on their own — pick your styles, sizes, and quantities and check out securely.",
  alternates: { canonical: "/order-apparel" },
};

export default async function OrderApparelPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const { err } = await searchParams;
  const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
  const shirt = rate?.shirtPriceCents ?? 2500;
  const tank = rate?.tankPriceCents ?? 2500;

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">PURE Academy</p>
          <h1 className="display text-3xl text-brand-900 sm:text-4xl">Order team apparel</h1>
          <p className="mt-2 text-slate-600">
            Want extra team gear, a different size, or apparel on its own? Order PURE Academy T-shirts
            ({formatCents(shirt)}) and tank tops ({formatCents(tank)}) here — you&apos;ll pick styles, sizes,
            and quantities on the next step and see your total before you pay.
          </p>
        </div>

        {err === "email" && (
          <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            Please enter a valid email so we can send your receipt.
          </p>
        )}

        <form method="POST" action="/api/apparel/start" className="card space-y-4">
          <div>
            <label className="label" htmlFor="name">Your name</label>
            <input id="name" name="name" className="input" placeholder="First and last name" />
          </div>
          <div>
            <label className="label" htmlFor="email">Email <span className="font-normal text-slate-400">(for your receipt)</span></label>
            <input id="email" name="email" type="email" required className="input" placeholder="email@example.com" />
          </div>
          <button className="btn-primary w-full py-3 text-base">Choose apparel &amp; check out →</button>
          <p className="text-center text-xs text-slate-400">
            Secure checkout is hosted by Stripe — we never see your card details. No account or login required.
          </p>
        </form>
      </div>
      <SiteFooter />
    </div>
  );
}
