-- CreateTable
CREATE TABLE "PayerResponseResolution" (
    "id" TEXT NOT NULL,
    "auditLogId" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayerResponseResolution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayerResponseResolution_auditLogId_key" ON "PayerResponseResolution"("auditLogId");
