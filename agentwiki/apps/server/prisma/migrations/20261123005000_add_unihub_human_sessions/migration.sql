CREATE TABLE "UniHubIdentityBinding" (
    "userId" TEXT NOT NULL,
    "centralUserId" TEXT NOT NULL,
    "syncedAuthVersion" INTEGER NOT NULL,

    CONSTRAINT "UniHubIdentityBinding_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "UniHubIdentityBinding_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UniHubIdentityBinding_centralUserId_key" ON "UniHubIdentityBinding"("centralUserId");

CREATE TABLE "UniHubUserSession" (
    "sid" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centralUserId" TEXT NOT NULL,
    "sourceProofToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UniHubUserSession_pkey" PRIMARY KEY ("sid"),
    CONSTRAINT "UniHubUserSession_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "UniHubIdentityBinding"("userId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "UniHubUserSession_userId_idx" ON "UniHubUserSession"("userId");
