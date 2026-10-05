-- Group booking roster: the other players's names/emails the booker entered.
ALTER TABLE "LessonSeries" ADD COLUMN "roster" JSONB;
