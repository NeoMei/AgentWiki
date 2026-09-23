-- The Agent management memory toggle and its authorization gate were removed.
-- AgentMemory rows remain intact for historical knowledge-revision compatibility.
ALTER TABLE "Agent" DROP COLUMN IF EXISTS "memoryEnabled";
