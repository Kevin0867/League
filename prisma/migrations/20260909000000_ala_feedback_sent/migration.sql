-- Track when a booking's post-lesson thank-you + review request was sent.
ALTER TABLE "AlaCarteBooking" ADD COLUMN "feedbackSentAt" TIMESTAMP(3);
