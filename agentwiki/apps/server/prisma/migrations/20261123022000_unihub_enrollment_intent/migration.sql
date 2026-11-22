CREATE TABLE "UniHubEnrollmentIntent" (
    "userId" TEXT NOT NULL,
    "reconcileAfter" TIMESTAMP(3) NOT NULL,
    "mappingObserved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UniHubEnrollmentIntent_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "UniHubEnrollmentIntent_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- A pre-upgrade event may belong to an enrollment that reached UniHub
-- before AgentWiki could save its mirror. Let the worker check that mapping.
INSERT INTO "UniHubEnrollmentIntent" ("userId", "reconcileAfter")
SELECT DISTINCT pending."userId", CURRENT_TIMESTAMP + INTERVAL '2 minutes'
FROM "UniHubLifecycleOutbox" AS pending
JOIN "User" AS source ON source."id" = pending."userId" AND source."type" = 'human'
WHERE NOT EXISTS (
    SELECT 1 FROM "UniHubIdentityBinding" WHERE "userId" = pending."userId"
);
