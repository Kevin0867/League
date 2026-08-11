import type { Metadata } from "next";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: { absolute: "Privacy Policy — PURE Academy" },
  description: "How PURE Pickleball & Padel accesses, collects, stores, uses, and shares your personal information.",
  alternates: { canonical: "/privacy" },
};

const TOC = [
  "What Information Do We Collect?",
  "How Do We Process Your Information?",
  "When and With Whom Do We Share Your Personal Information?",
  "Do We Use Cookies and Other Tracking Technologies?",
  "How Do We Handle Your Social Logins?",
  "How Long Do We Keep Your Information?",
  "What Are Your Privacy Rights?",
  "Controls for Do-Not-Track Features",
  "Do United States Residents Have Specific Privacy Rights?",
  "Do We Make Updates to This Notice?",
  "How Can You Contact Us About This Notice?",
  "How Can You Review, Update, or Delete the Data We Collect from You?",
];

export default function PrivacyPage() {
  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="display text-3xl text-brand-900 sm:text-4xl">Privacy Policy</h1>

        <div className="mt-6 space-y-6 text-sm leading-relaxed text-slate-700">
          <p>
            This Privacy Notice for Pure Pickleball &amp; Padel (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
            &ldquo;our&rdquo;), describes how and why we might access, collect, store, use, and/or share
            (&ldquo;process&rdquo;) your personal information when you use our services (&ldquo;Services&rdquo;),
            including when you: Visit our website at{" "}
            <a href="https://purepickleball.com/" className="text-brand-700 hover:underline">https://purepickleball.com/</a>,
            or any website of ours that links to this Privacy Notice. Engage with us in other related ways, including
            any sales, marketing, or events.
          </p>
          <p>
            <span className="font-semibold text-slate-900">Questions or concerns?</span> Reading this Privacy Notice
            will help you understand your privacy rights and choices. We are responsible for making decisions about
            how your personal information is processed. If you do not agree with our policies and practices, please do
            not use our Services. If you still have any questions or concerns, please contact us at{" "}
            <a href="mailto:contact@purepickleball.com" className="text-brand-700 hover:underline">contact@purepickleball.com</a>.
          </p>

          <section>
            <h2 className="font-semibold text-slate-900">Summary of Key Points</h2>
            <p className="mt-1">
              This summary provides key points from our Privacy Notice, but you can find out more details about any of
              these topics by reading the full sections below.
            </p>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li><strong>What personal information do we process?</strong> When you visit, use, or navigate our Services, we may process personal information depending on how you interact with us and the Services, the choices you make, and the products and features you use.</li>
              <li><strong>Do we process any sensitive personal information?</strong> We do not process sensitive personal information.</li>
              <li><strong>Do we collect any information from third parties?</strong> We may collect information from public databases, marketing partners, social media platforms, and other outside sources.</li>
              <li><strong>How do we process your information?</strong> We process your information to provide, improve, and administer our Services, communicate with you, for security and fraud prevention, and to comply with law. We may also process your information for other purposes with your consent.</li>
              <li><strong>In what situations and with which parties do we share personal information?</strong> We may share information in specific situations and with specific third parties.</li>
              <li><strong>What are your rights?</strong> Depending on where you are located geographically, the applicable privacy law may mean you have certain rights regarding your personal information.</li>
              <li><strong>How do you exercise your rights?</strong> The easiest way to exercise your rights is by submitting a data subject access request, or by contacting us. We will consider and act upon any request in accordance with applicable data protection laws.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-slate-900">Table of Contents</h2>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              {TOC.map((t) => <li key={t}>{t}</li>)}
            </ol>
          </section>

          <Section n={1} title="What Information Do We Collect?">
            <p>
              Personal information you disclose to us. We collect personal information that you voluntarily provide to
              us when you register on the Services, express an interest in obtaining information about us or our
              products and Services, when you participate in activities on the Services, or otherwise when you contact
              us.
            </p>
          </Section>
          <Section n={2} title="How Do We Process Your Information?">
            <p>
              We process your information to provide, improve, and administer our Services, communicate with you, for
              security and fraud prevention, and to comply with law. We may also process your information for other
              purposes with your consent. We process your information only when we have a valid legal reason to do so.
            </p>
          </Section>
          <Section n={3} title="When and With Whom Do We Share Your Personal Information?">
            <p>We may share information in specific situations and with specific third parties as described in this section.</p>
          </Section>
          <Section n={4} title="Do We Use Cookies and Other Tracking Technologies?">
            <p>We may use cookies and similar tracking technologies (like web beacons and pixels) to gather information when you interact with our Services.</p>
          </Section>
          <Section n={5} title="How Do We Handle Your Social Logins?">
            <p>If you choose to register or log in to our Services using a social media account, we may have access to certain information about you.</p>
          </Section>
          <Section n={6} title="How Long Do We Keep Your Information?">
            <p>We will only keep your personal information for as long as it is necessary for the purposes set out in this Privacy Notice, unless a longer retention period is required or permitted by law.</p>
          </Section>
          <Section n={7} title="What Are Your Privacy Rights?">
            <p>Depending on where you are located geographically, the applicable privacy law may mean you have certain rights regarding your personal information. You may review, change, or terminate your account at any time.</p>
          </Section>
          <Section n={8} title="Controls for Do-Not-Track Features">
            <p>Most web browsers and some mobile operating systems and mobile applications include a Do-Not-Track (&ldquo;DNT&rdquo;) feature or setting you can activate to signal your privacy preference not to have data about your online browsing activities monitored and collected.</p>
          </Section>
          <Section n={9} title="Do United States Residents Have Specific Privacy Rights?">
            <p>If you are a resident of certain US states, you may have specific rights regarding access to your personal information. You can contact us to exercise these rights.</p>
            <p>
              <span className="font-semibold text-slate-900">California &ldquo;Shine The Light&rdquo; Law:</span>{" "}
              California Civil Code Section 1798.83 permits our users who are California residents to request and obtain
              from us, once a year and free of charge, information about categories of personal information (if any) we
              disclosed to third parties for direct marketing purposes. If you are a California resident and would like
              to make such a request, please contact us using the information provided below.
            </p>
          </Section>
          <Section n={10} title="Do We Make Updates to This Notice?">
            <p>Yes, we will update this notice as necessary to stay compliant with relevant laws. We may update this Privacy Notice from time to time. The updated version will be indicated by an updated &ldquo;Revised&rdquo; date at the top of this Privacy Notice. We encourage you to review this Privacy Notice frequently to be informed of how we are protecting your information.</p>
          </Section>
          <Section n={11} title="How Can You Contact Us About This Notice?">
            <p>
              If you have questions or comments about this notice, you may contact us by email at{" "}
              <a href="mailto:contact@purepickleball.com" className="text-brand-700 hover:underline">contact@purepickleball.com</a>.
            </p>
            <p>Pure Pickleball &amp; Padel<br />United States</p>
          </Section>
          <Section n={12} title="How Can You Review, Update, or Delete the Data We Collect from You?">
            <p>
              Based on the applicable laws of your country or state of residence in the US, you may have the right to
              request access to the personal information we collect from you, details about how we have processed it,
              correct inaccuracies, or delete your personal information. You may also have the right to withdraw your
              consent to our processing of your personal information. To request to review, update, or delete your
              personal information, please contact us at{" "}
              <a href="mailto:contact@purepickleball.com" className="text-brand-700 hover:underline">contact@purepickleball.com</a>.
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
