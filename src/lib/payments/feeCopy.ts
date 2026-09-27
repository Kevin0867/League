// Shared season-fee wording, kept dependency-free so any module can import it
// without risking an import cycle.

// The Stripe description shown on 3-payment-plan charges (and thus on Stripe's
// receipts / merchant notifications). Installment-plan wording — NOT the one-time
// "reserves a place" copy — so a recurring charge reads as one of the season-fee
// payments for a player who is already on the team.
export const SEASON_SUBSCRIPTION_DESCRIPTION =
  "One of your 3 season-fee payments (billed every 30 days) — you're on the team for the season. Individual practices PURE cancels are not refunded or credited.";
