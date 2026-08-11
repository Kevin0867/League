import type { Metadata } from "next";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: { absolute: "Season Terms & Refund Policy — PURE Academy" },
  description: "PURE Academy Fall 2026 season terms, fees, cancellation and refund policy.",
  alternates: { canonical: "/season-terms" },
};

export default function SeasonTermsPage() {
  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="display text-3xl text-brand-900 sm:text-4xl">Season Terms &amp; Refund Policy</h1>
        <p className="mt-2 text-slate-500">PURE Academy Fall 2026 · Arizona Club Pickleball</p>

        <div className="mt-8 space-y-5 text-slate-700">
          <Item>
            <strong>$495 per player.</strong> Payment is requested after a player is assigned a team, coach,
            location, day, and time — not at registration.
          </Item>
          <Item>
            The season fee reserves a place on a team, not a fixed number of sessions.
          </Item>
          <Item>
            <strong>Practices cancelled by PURE for weather, heat, or facility closure are not rescheduled and are
            not refunded.</strong> ACP league matches and the Championship are rescheduled rather than cancelled.
          </Item>
          <Item>
            <strong>Withdrawal during Weeks 1–2:</strong> pro-rated credit toward a future season, no cash refund.
          </Item>
          <Item>
            <strong>From Week 3:</strong> no refund or credit except under the injury and medical terms.
          </Item>
          <Item>
            If PURE cancels a season or a team mid-season, a pro-rated refund is issued automatically.
          </Item>
          <Item>
            Two forfeited ACP matches ends Championship eligibility with no refund; reinstatement requires an
            exception from the Academy Director and the COO.
          </Item>
          <Item>
            No Academy activity during Thanksgiving week, November 23–29.
          </Item>
        </div>

        <p className="mt-8 text-sm text-slate-500">
          Questions? <a href="mailto:team@purepickleball.com" className="text-brand-700 hover:underline">team@purepickleball.com</a> · Stephanie Newton, Director &amp; Head Coach · <a href="tel:+12085695500" className="text-brand-700 hover:underline">208.569.5500</a>
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border-l-4 border-brand-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed">
      {children}
    </div>
  );
}
