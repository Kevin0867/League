-- One-time marker so the automated mid-season feedback request fires once.
ALTER TABLE "Season" ADD COLUMN "midseasonFeedbackSentAt" TIMESTAMP(3);
