# Multi-Space Agent Connection Design

## Goal

Allow one local `agentwiki` gateway installation to retain and use connections for multiple Spaces without replacing an earlier Space connection or mixing data.

## Boundaries

- Each server credential remains bound to exactly one `AgentGrant` and one Space.
- A local gateway stores a set of Space-scoped connections under one gateway installation.
- Every remote or sync operation must receive an explicit `spaceId`; no mutable global current Space is introduced.
- Existing single-connection config is migrated in memory and on write without breaking existing users.
- A missing or unauthorized `spaceId` fails closed with an actionable error.

## Data flow

1. Each onboarding exchange returns one Space-scoped credential as today.
2. Local persistence merges the exchanged connection into `connections`, keyed by connection id, preserving existing entries.
3. Gateway loads all configured connections and credentials. For remote MCP calls, it selects the credential by `spaceId`; `list_spaces` remains the discovery tool and returns server-authorized Spaces.
4. Local knowledge pull/prepare/sync already carries `spaceId`; it uses the matching connection instead of the default credential.
5. Client configuration still has one `agentwiki` process entry. The process receives the connection set and routes per call.

## Failure handling

- Unknown Space: return a local validation error naming the required `spaceId`.
- Space configured without a credential: return a configuration error; do not fall back to another Space.
- Existing config: preserve all entries and default connection behavior for calls that already supply a Space.
- Concurrent config writes continue using atomic replacement.

## Verification

- Config persistence retains two connections after adding a second Space.
- Gateway selects Space A and Space B credentials independently, including concurrent calls.
- Unknown Space never uses the default credential.
- Existing single-Space tests remain green and type/build checks pass.
