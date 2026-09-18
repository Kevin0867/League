-- Editable P&L line items per month (Phoenix "YYYY-MM"). Booked revenue and
-- scheduled costs are computed live; these are the admin's own editable rows
-- (extra revenue + every expense) and FORECAST projection rows. Amounts in cents.
CREATE TABLE "PnlEntry" (
  "id"          TEXT NOT NULL,
  "month"       TEXT NOT NULL,
  "section"     TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL DEFAULT 0,
  "kind"        TEXT NOT NULL DEFAULT 'ACTUAL',
  "note"        TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PnlEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PnlEntry_month_idx" ON "PnlEntry"("month");
