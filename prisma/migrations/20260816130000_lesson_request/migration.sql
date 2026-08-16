-- Public lesson/clinic request capture (from /clinics/request).
CREATE TABLE "LessonRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "requestType" TEXT NOT NULL DEFAULT 'UNSURE',
    "skillLevel" TEXT,
    "locations" TEXT,
    "preferredTimes" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LessonRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LessonRequest_status_createdAt_idx" ON "LessonRequest"("status", "createdAt");
