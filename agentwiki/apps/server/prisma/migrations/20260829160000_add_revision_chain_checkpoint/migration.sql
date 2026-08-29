CREATE TABLE "SpaceRevisionChainCheckpoint" (
  "spaceId" TEXT NOT NULL,
  "contractVersion" TEXT NOT NULL,
  "boundarySequence" INTEGER NOT NULL,
  "boundaryRevisionId" TEXT NOT NULL,
  "boundaryParentRevisionId" TEXT,
  "boundaryRevisionContentHash" TEXT NOT NULL,
  "rollingChainHash" TEXT NOT NULL,
  "anchorSequence" INTEGER NOT NULL,
  "anchorRevisionId" TEXT NOT NULL,
  "anchorParentRevisionId" TEXT NOT NULL,
  "anchorRevisionContentHash" TEXT NOT NULL,
  "anchorTreeDeltaHash" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpaceRevisionChainCheckpoint_pkey" PRIMARY KEY ("spaceId"),
  CONSTRAINT "SpaceRevisionChainCheckpoint_contractVersion_check"
    CHECK ("contractVersion" = 'revision-chain-checkpoint@1'),
  CONSTRAINT "SpaceRevisionChainCheckpoint_boundary_check"
    CHECK (
      "boundarySequence" > 0
      AND length("boundaryRevisionId") > 0
      AND "boundaryRevisionId" IS DISTINCT FROM "boundaryParentRevisionId"
      AND (
        ("boundarySequence" = 1 AND "boundaryParentRevisionId" IS NULL)
        OR
        ("boundarySequence" > 1 AND length("boundaryParentRevisionId") > 0)
      )
    ),
  CONSTRAINT "SpaceRevisionChainCheckpoint_boundaryContentHash_check"
    CHECK ("boundaryRevisionContentHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "SpaceRevisionChainCheckpoint_rollingChainHash_check"
    CHECK ("rollingChainHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "SpaceRevisionChainCheckpoint_anchor_check"
    CHECK (
      "anchorSequence" = "boundarySequence" + 1
      AND length("anchorRevisionId") > 0
      AND "anchorRevisionId" <> "boundaryRevisionId"
      AND "anchorParentRevisionId" = "boundaryRevisionId"
    ),
  CONSTRAINT "SpaceRevisionChainCheckpoint_anchorRevisionContentHash_check"
    CHECK ("anchorRevisionContentHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "SpaceRevisionChainCheckpoint_anchorTreeDeltaHash_check"
    CHECK ("anchorTreeDeltaHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "SpaceRevisionChainCheckpoint_evidenceHash_check"
    CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "SpaceRevisionChainCheckpoint"
  ADD CONSTRAINT "SpaceRevisionChainCheckpoint_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
