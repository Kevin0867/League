import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: { absolute: "Terms of Service — PURE Academy" },
  description: "The terms that govern use of the PURE Academy website and participation in PURE Academy and Arizona Club Pickleball programs.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="display text-3xl text-brand-900 sm:text-4xl">Terms of Service</h1>
        <p className="mt-2 text-slate-500">PURE Pickleball &amp; Padel · Arizona Club Pickleball</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-slate-700">
          <Section title="Using this site">
            <p>
              By using academy.purepickleball.com, registering a player, or entering a team, you agree to these
              terms. If you are registering a player under 18, you confirm you are their parent or legal guardian
              and accept these terms on their behalf.
            </p>
          </Section>
          <Section title="Accounts">
            <p>
              You are responsible for the accuracy of the information you provide and for keeping your account
              credentials secure. Notify us promptly of any unauthorized use.
            </p>
          </Section>
          <Section title="Payments">
            <p>
              Fees, payment timing, cancellations, and refunds are governed by our{" "}
              <Link href="/season-terms" className="text-brand-700 hover:underline">Season Terms &amp; Refund Policy</Link>.
              Payments are processed by our payment provider; we do not store card details.
            </p>
          </Section>
          <Section title="Participation, waiver, and conduct">
            <p>
              Participation requires a signed participation waiver and adherence to program rules and the PURE
              code of conduct. Every coach completes a background check and PURE curriculum training before Week 1.
              We may suspend or remove participation for conduct that endangers players or staff.
            </p>
          </Section>
          <Section title="Privacy">
            <p>
              Our handling of personal data — including minors&apos; data, medical disclosures, and DUPR identity —
              is described in our <Link href="/privacy" className="text-brand-700 hover:underline">Privacy Policy</Link>.
            </p>
          </Section>
          <Section title="Changes and contact">
            <p>
              We may update these terms; material changes will be posted here. Questions:{" "}
              <a href="mailto:stephanie@purepickleball.com" className="text-brand-700 hover:underline">stephanie@purepickleball.com</a> · 208.569.5500.
            </p>
          </Section>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <div className="mt-1">{children}</div>
    </section>
  );
}
