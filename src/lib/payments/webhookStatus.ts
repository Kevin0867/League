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
const HELPFUL_EVENTS = ["checkout.session.completed", "invoice.paid", "invoice.payment_failed", "checkout.session.expired"];
export const WEBHOOK_PATH = "/api/stripe/webhook";

export type WebhookEndpointInfo = {
  url: string;
  status: string; // "enabled" | "disabled"
  pointsHere: boolean;
  coversRequired: boolean; // subscribed to checkout.session.completed (or "*")
  missingHelpful: string[];
};

export type WebhookStatus = {
  stripeConfigured: boolean;
  webhookSecretSet: boolean;
  expectedUrl: string;
  listed: boolean; // did we successfully read endpoints from Stripe
  listError?: string;
  endpoints: WebhookEndpointInfo[];
  matchingHealthy: boolean; // an enabled endpoint here covers the required event
};

export async function getStripeWebhookStatus(): Promise<WebhookStatus> {
  const expectedUrl = `${appUrl()}${WEBHOOK_PATH}`;
  const base: WebhookStatus = {
    stripeConfigured: isStripeConfigured(),
    webhookSecretSet: !!process.env.STRIPE_WEBHOOK_SECRET,
    expectedUrl,
    listed: false,
    endpoints: [],
    matchingHealthy: false,
  };
  if (!base.stripeConfigured) return base;

  try {
    const list = await stripe().webhookEndpoints.list({ limit: 100 });
    base.listed = true;
    base.endpoints = list.data.map((e) => {
      const events = e.enabled_events ?? [];
      const coversRequired = events.includes("*") || events.includes(REQUIRED_EVENT);
      const missingHelpful = events.includes("*") ? [] : HELPFUL_EVENTS.filter((ev) => !events.includes(ev));
      return {
        url: e.url,
        status: e.status ?? "unknown",
        pointsHere: e.url.replace(/\/$/, "").endsWith(WEBHOOK_PATH),
        coversRequired,
        missingHelpful,
      };
    });
    base.matchingHealthy = base.endpoints.some((e) => e.pointsHere && e.status === "enabled" && e.coversRequired);
  } catch (e) {
    base.listError = e instanceof Error ? e.message.slice(0, 160) : "couldn't read webhooks from Stripe";
  }
  return base;
}
