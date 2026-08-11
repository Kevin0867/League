import type { Metadata } from "next";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: { absolute: "Privacy Policy — PURE Academy" },
  description: "How PURE Academy collects, uses, shares, and retains personal data — including minors' data — and how to request deletion.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="display text-3xl text-brand-900 sm:text-4xl">Privacy Policy</h1>
        <p className="mt-2 text-slate-500">PURE Pickleball &amp; Padel · Arizona Club Pickleball</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-slate-700">
          <Section title="What we collect">
            <p>
              To register and place players we collect: player and parent/guardian names, dates of birth, and
              contact details (email, phone, address); <strong>minors&apos; data</strong> for players under 18;
              <strong> medical disclosures and emergency contacts</strong> used for on-court safety; skill and
              rating information including a <strong>DUPR identity</strong> where a player has one; media
              opt-out preferences; and payment information handled by our payment processor (we never store card
              numbers).
            </p>
          </Section>
          <Section title="How we use it">
            <p>
              To enroll players, form and publish teams, schedule and run practices and matches, communicate with
              families and coaches, record attendance, process fees, and submit league results to DUPR. Emergency
              and medical information is used only to keep players safe during activities.
            </p>
          </Section>
          <Section title="Who we share it with">
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>DUPR</strong> — match results and player identity, so games count toward ratings.</li>
              <li><strong>Our payment processor (Stripe)</strong> — to take payment; card data goes to Stripe, not us.</li>
              <li><strong>Facilities</strong> — the minimum needed to host practices and matches.</li>
            </ul>
            <p className="mt-2">We do not sell personal data.</p>
          </Section>
          <Section title="Retention">
            <p>
              We keep records for as long as needed to run the program and meet legal, tax, and safety
              obligations, then delete or anonymize them. Platform messages are retained for moderation and
              safety review.
            </p>
          </Section>
          <Section title="Requesting deletion">
            <p>
              You may request access to, correction of, or deletion of your data — or a minor&apos;s data as their
              parent or guardian — by emailing{" "}
              <a href="mailto:stephanie@purepickleball.com" className="text-brand-700 hover:underline">stephanie@purepickleball.com</a>.
              We honor requests except where we must retain records by law.
            </p>
          </Section>
        </div>

        <p className="mt-8 text-sm text-slate-500">
          Contact: <a href="mailto:stephanie@purepickleball.com" className="text-brand-700 hover:underline">stephanie@purepickleball.com</a> · 208.569.5500
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <div className="mt-1 text-slate-700">{children}</div>
    </section>
  );
}
