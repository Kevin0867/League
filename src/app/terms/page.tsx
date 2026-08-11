import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: { absolute: "Terms of Service — PURE Academy" },
  description: "The terms that govern use of PURE Pickleball & Padel's website, facilities, coaching, and retail services.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="display text-3xl text-brand-900 sm:text-4xl">Terms of Service</h1>
        <p className="mt-2 text-sm text-slate-500">Last Updated: November 2025</p>

        <div className="mt-6 space-y-6 text-sm leading-relaxed text-slate-700">
          <p>
            Welcome to PURE Pickleball &amp; Padel (&ldquo;PURE,&rdquo; &ldquo;we,&rdquo; &ldquo;our,&rdquo; or
            &ldquo;us&rdquo;). These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of our
            website, facilities, coaching services, retail offerings, online content, and any related products or
            services (collectively, the &ldquo;Services&rdquo;). By accessing or using our Services, you agree to be
            bound by these Terms. If you do not agree, please do not use our Services.
          </p>

          <Section n={1} title="Eligibility">
            <p>
              You must be at least 18 years old, or the legal age of majority in your jurisdiction, to use our
              Services. Minors may participate in coaching or facility activities only with parental or guardian
              consent.
            </p>
          </Section>

          <Section n={2} title="Services Provided">
            <p>PURE Pickleball &amp; Padel operates as:</p>
            <Bullets items={[
              "A pickleball and padel sports facility",
              "A coaching and training provider",
              "A retailer of pickleball, padel, and related sporting goods",
              "A website that provides scheduling, registration, communication, and purchasing capabilities",
            ]} />
            <p>We reserve the right to modify, suspend, or discontinue any Service at any time.</p>
          </Section>

          <Section n={3} title="Account Registration">
            <p>
              To access certain Services, you may be required to create an account and provide personal information,
              including: First Name, Last Name, Email Address, and Mobile Number.
            </p>
            <p>
              You agree to provide accurate, complete information and to update it as needed. You are responsible for
              maintaining the confidentiality of your account credentials and for all activity that occurs under your
              account.
            </p>
          </Section>

          <Section n={4} title="User Conduct">
            <p>You agree not to:</p>
            <Bullets items={[
              "Use the Services for unlawful or harmful purposes",
              "Interfere with or disrupt the integrity of the Services",
              "Attempt to access accounts or systems without authorization",
              "Engage in harassment, abuse, or unsafe behavior on the premises or online",
            ]} />
            <p>We may suspend or terminate access for violations of these Terms.</p>
          </Section>

          <Section n={5} title="Facility Rules & Assumption of Risk">
            <p>
              Participation in pickleball and padel activities involves inherent physical risks. By using our facility
              or participating in instruction, you acknowledge and accept these risks and agree that PURE is not
              responsible for injuries, accidents, or damages resulting from participation. Additional on-site rules
              may be posted and must be followed at all times.
            </p>
          </Section>

          <Section n={6} title="Payments, Bookings & Refunds">
            <p>
              Fees for facility use, coaching, events, or merchandise are clearly listed on our website or at point of
              sale. By completing a purchase or booking, you agree to pay all applicable charges. Refunds,
              cancellations, and rescheduling policies may vary by service and are outlined on the relevant booking or
              sales pages — for the PURE Academy season, see our{" "}
              <Link href="/season-terms" className="text-brand-700 hover:underline">Season Terms &amp; Refund Policy</Link>.
            </p>
          </Section>

          <Section n={7} title="Retail Purchases">
            <p>
              Products sold online or in-store are subject to availability. We may change pricing, discontinue
              products, or limit order quantities at any time.
            </p>
          </Section>

          <Section n={8} title="Privacy & Data Collection">
            <p>
              By using our Services, you consent to our collection of personal information including: first name, last
              name, email address, and mobile number. We may use this information to manage bookings and accounts,
              communicate about purchases, scheduling, or updates, send promotional or marketing messages (you may
              opt-out), and improve our Services.
            </p>
            <p>
              For detailed information on how data is collected, stored, and used, please refer to our{" "}
              <Link href="/privacy" className="text-brand-700 hover:underline">Privacy Policy</Link>.
            </p>
          </Section>

          <Section n={9} title="Communications">
            <p>
              By providing your email or mobile number, you agree to receive notifications related to scheduling,
              account activity, promotions, or important updates. Text message and data rates may apply. You may
              unsubscribe or opt-out at any time.
            </p>
          </Section>

          <Section n={10} title="Intellectual Property">
            <p>
              All content on our website — including logos, images, text, videos, and designs — is owned by or licensed
              to PURE and protected by intellectual property laws. You may not copy, reproduce, or redistribute any
              content without permission.
            </p>
          </Section>

          <Section n={11} title="Disclaimers">
            <p>
              Our Services are provided &ldquo;as is&rdquo; without warranties of any kind. We do not guarantee that
              the Services will be error-free or uninterrupted, the website will be free of viruses or harmful
              components, or that coaching or training will result in specific performance outcomes.
            </p>
          </Section>

          <Section n={12} title="Limitation of Liability">
            <p>
              To the fullest extent permitted by law, PURE Pickleball &amp; Padel is not liable for injuries or damages
              arising from sports participation, loss of personal property, website errors, data breaches, or service
              interruptions, or any indirect, incidental, or consequential damages. Your sole remedy for
              dissatisfaction with the Services is to discontinue use.
            </p>
          </Section>

          <Section n={13} title="Indemnification">
            <p>
              You agree to defend, indemnify, and hold harmless PURE Pickleball &amp; Padel from claims, liabilities,
              damages, or expenses arising from your use of the Services or violation of these Terms.
            </p>
          </Section>

          <Section n={14} title="Changes to Terms">
            <p>
              We may update these Terms from time to time. Continued use of our Services after changes take effect
              constitutes acceptance of the updated Terms.
            </p>
          </Section>

          <Section n={15} title="Governing Law">
            <p>
              These Terms are governed by the laws of Arizona. Any disputes will be resolved in the courts of that
              jurisdiction.
            </p>
          </Section>

          <Section n={16} title="Contact Information">
            <p>If you have questions about these Terms or the Services, you may contact us at:</p>
            <p>
              PURE Pickleball &amp; Padel<br />
              Email: <a href="mailto:info@purepickleball.com" className="text-brand-700 hover:underline">info@purepickleball.com</a><br />
              Website: <a href="https://www.purepickleball.com" className="text-brand-700 hover:underline">www.purepickleball.com</a>
            </p>
          </Section>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-semibold text-slate-900">{n}. {title}</h2>
      <div className="mt-1 space-y-2">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((i) => <li key={i}>{i}</li>)}
    </ul>
  );
}
