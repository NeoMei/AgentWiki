CREATE TABLE "UniHubNativeBrowserSession" (
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "UniHubNativeBrowserSession_delivery_idx"
    ON "UniHubNativeBrowserSession" ("deliveredAt", "availableAt");
CREATE INDEX "UniHubNativeBrowserSession_expiresAt_idx"
    ON "UniHubNativeBrowserSession" ("expiresAt");
ALTER TABLE "UniHubUserSession" ADD COLUMN "generation" TEXT NOT NULL DEFAULT '1';
