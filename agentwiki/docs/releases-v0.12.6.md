# AgentWiki v0.12.6

Removed the unused Agent memory management feature.

- Removed the Agent detail Memory tab and memory enable switch.
- Removed Agent memory REST services, MCP `recall_memory`, memory scopes, and authorization gates.
- Removed the `Agent.memoryEnabled` database column through a Prisma migration.
- Kept historical `AgentMemory` rows and legacy knowledge-bundle fields for compatibility; new Agent memory synchronization is rejected.

Validation:

- Server typecheck and build passed.
- Client typecheck and build passed.
- Agent authorization and knowledge-submission tests passed.
- Client test suite: 111 files, 1513 tests passed.
- Sync protocol tests: 10 files, 140 tests passed.
