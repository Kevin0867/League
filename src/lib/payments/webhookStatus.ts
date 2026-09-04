import "server-only";
import { stripe, isStripeConfigured, appUrl } from "@/lib/stripe";

// Read-only diagnostic for the Stripe payment webhook — the usual reason a paid
// charge never gets recorded here. Surfaces, without leaving the console:
//   • whether Stripe + the signing secret are configured,
//   • which webhook endpoints Stripe has, and
//   • whether any points at THIS app and is subscribed to the completion event.
// The signing-secret VALUE can't be read back from Stripe, so a wrong (vs
// missing) secret still has to be confirmed in the dashboard — but a missing
// endpoint or missing event is caught here.

const REQUIRED_EVENT = "checkout.session.completed";
// BOTH of these are required for full coverage:
//   • checkout.session.completed — records one-time / pay-in-full fees and links
//     a new subscription to its Payment row.
//   • invoice.paid — records EACH installment of a 3-payment plan. Without it a
//     subscription is linked but never advances past "0 paid", so every payment
//     plan silently shows as unpaid no matter how many charges actually cleared.
const CRITICAL_EVENTS = ["checkout.session.completed", "invoice.paid"];

function safeHost(u: string): string {
  try { return new URL(u).host; } catch { return ""; }
}
const HELPFUL_EVENTS = ["checkout.session.completed", "invoice.paid", "invoice.payment_failed", "checkout.session.expired"];
export const WEBHOOK_PATH = "/api/stripe/webhook";

export type WebhookEndpointInfo = {
  id: string;
  url: string;
  status: string; // "enabled" | "disabled"
  pointsHere: boolean; // exact host + path match for THIS deployment
  samePathOtherHost: boolean; // our webhook path, but a different domain (e.g. another deployment/DB)
  coversRequired: boolean; // subscribed to checkout.session.completed (or "*")
  coversInvoicePaid: boolean; // subscribed to invoice.paid (or "*") — needed for subscriptions
  missingCritical: string[]; // of CRITICAL_EVENTS, the ones NOT covered
  missingHelpful: string[];
  dashboardUrl: string; // deep link to this endpoint (signing secret + deliveries live here)
};

export type WebhookStatus = {
  stripeConfigured: boolean;
  webhookSecretSet: boolean;
  liveMode: boolean;
  expectedUrl: string;
  // Direct Stripe dashboard links (mode-aware: live vs test).
  webhooksUrl: string;
  createUrl: string;
  apiKeysUrl: string;
  listed: boolean; // did we successfully read endpoints from Stripe
  listError?: string;
  endpoints: WebhookEndpointInfo[];
  matchingHealthy: boolean; // an enabled endpoint here covers the required event
};

export async function getStripeWebhookStatus(): Promise<WebhookStatus> {
  const expectedUrl = `${appUrl()}${WEBHOOK_PATH}`;
  // Live vs test decides the dashboard path (…/webhooks vs …/test/webhooks).
  // We only read the key's PREFIX to pick the URL — never log or expose the key.
  const liveMode = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live");
  const dash = liveMode ? "https://dashboard.stripe.com" : "https://dashboard.stripe.com/test";

  const base: WebhookStatus = {
    stripeConfigured: isStripeConfigured(),
    webhookSecretSet: !!process.env.STRIPE_WEBHOOK_SECRET,
    liveMode,
    expectedUrl,
    webhooksUrl: `${dash}/webhooks`,
    createUrl: `${dash}/webhooks/create`,
    apiKeysUrl: `${dash}/apikeys`,
    listed: false,
    endpoints: [],
    matchingHealthy: false,
  };
  if (!base.stripeConfigured) return base;

  const expectedHost = safeHost(expectedUrl);
  try {
    const list = await stripe().webhookEndpoints.list({ limit: 100 });
    base.listed = true;
    base.endpoints = list.data.map((e) => {
      const events = e.enabled_events ?? [];
      const coversAll = events.includes("*");
      const coversRequired = coversAll || events.includes(REQUIRED_EVENT);
      const coversInvoicePaid = coversAll || events.includes("invoice.paid");
      const missingCritical = coversAll ? [] : CRITICAL_EVENTS.filter((ev) => !events.includes(ev));
      const missingHelpful = coversAll ? [] : HELPFUL_EVENTS.filter((ev) => !events.includes(ev));
      const host = safeHost(e.url);
      const pathMatches = e.url.replace(/\/$/, "").endsWith(WEBHOOK_PATH);
      const pointsHere = pathMatches && !!expectedHost && host === expectedHost;
      return {
        id: e.id,
        url: e.url,
        status: e.status ?? "unknown",
        pointsHere,
        samePathOtherHost: pathMatches && !pointsHere,
        coversRequired,
        coversInvoicePaid,
        missingCritical,
        missingHelpful,
        dashboardUrl: `${dash}/webhooks/${e.id}`,
      };
    });
    // Healthy = an enabled endpoint here that covers BOTH critical events
    // (one-time completion AND subscription installments).
    base.matchingHealthy = base.endpoints.some((e) => e.pointsHere && e.status === "enabled" && e.missingCritical.length === 0);
  } catch (e) {
    base.listError = e instanceof Error ? e.message.slice(0, 160) : "couldn't read webhooks from Stripe";
  }
  return base;
}
