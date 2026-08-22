CREATE TYPE "AgentAccessRole" AS ENUM ('reader', 'editor', 'publisher');

ALTER TABLE "AgentCredential"
  ADD COLUMN "role" "AgentAccessRole" NOT NULL DEFAULT 'reader';

ALTER TABLE "AgentGrant" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "AgentGrant"
  ALTER COLUMN "role" TYPE "AgentAccessRole"
  USING ('reader'::"AgentAccessRole");
ALTER TABLE "AgentGrant" ALTER COLUMN "role" SET DEFAULT 'reader';
