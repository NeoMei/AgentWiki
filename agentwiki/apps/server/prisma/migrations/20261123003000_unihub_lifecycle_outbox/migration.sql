CREATE TABLE "UniHubLifecycleOutbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "previousLocalVersion" INTEGER NOT NULL CHECK ("previousLocalVersion" >= 0),
    "state" TEXT CHECK ("state" IN ('locked', 'active', 'deleted')),
    "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UniHubLifecycleOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UniHubLifecycleOutbox_userId_previousLocalVersion_key"
    ON "UniHubLifecycleOutbox"("userId", "previousLocalVersion");

CREATE INDEX "UniHubLifecycleOutbox_availableAt_id_idx"
    ON "UniHubLifecycleOutbox"("availableAt", "id");
