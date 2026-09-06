-- Requester's chosen coach (by name) for a private/semi-private lesson request.
ALTER TABLE "LessonRequest" ADD COLUMN "preferredCoach" TEXT;
