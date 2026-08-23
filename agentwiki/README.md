# AgentWiki

A knowledge base system designed for **people and AI Agents**. Write in Markdown, connect information through a knowledge graph, search semantically, and let Agents participate in your knowledge workflow with fine-grained permissions.

> **v0.6.0** — Agent collaboration templates, observable workflows, and unified `reader | editor | publisher` gateway access.


## Hosted Service

Use AgentWiki immediately without provisioning PostgreSQL, Redis, or your own server:

- [Open AgentWiki](https://agentwiki.quukk.com)
- [Usage Guide](https://agentwiki.quukk.com/guide)

Create an account to start a Space, invite collaborators, and connect local Agents such as Codex, Claude Code, and OpenCode. Self-hosting remains available below for private deployments and development.

Obsidian users can additionally install the
[AgentWiki Sync](https://github.com/NeoMei/agentwiki-sync) community plugin to sync a vault
with a Space. See the [Obsidian plugin guide](https://agentwiki.quukk.com/guide/obsidian)
for setup details.

## Features

### Wiki & Editor
- **Obsidian-style Live Preview** — edit Markdown with inline formatting visible, no split-pane switching
- **Hierarchical page tree** — organize pages with parent-child relationships, drag to reorder and re-nest
- **Wiki-links & anchors** — `[[Page Name]]` resolves to internal pages; headings generate anchor links
- **Version history** — every save creates a version; restore any previous state with one click
- **Real-time collaboration** — authenticated WebSocket sessions sync edits across users

### Knowledge Graph
- **Semantic relationships** — connect pages with typed relations (supports, contradicts, extends...)
- **Auto-generation** — wiki-link extraction, embedding similarity, and reviewed LLM proposals keep the graph current
- **Visual exploration** — interactive graph view with node/edge inspection
- **Evidence & provenance** — every relationship tracks its source, run and confidence level

### Semantic Search
- **Vector-powered** — goes beyond keyword matching with embedding-based relevance
- **Space-scoped** — search respects your access boundaries
- **Text fallback** — degrades gracefully when embeddings are offline

### Agent Integration
- **Independent identity** — Agents have their own credentials (`agk_...`), not shared user tokens
- **Unified Agent roles** — choose Reader, Editor, or Publisher once; `AgentGrant.role` is the only persisted permission and scopes are derived at request time
- **Review workflow** — Agent writes enter a ChangeSet for human approval before publishing
- **Least privilege** — each identity-only Credential binds one Space Grant; effective access is limited by its live role, connection/Agent state, Space policy, and domain authorization
- **Memory** — episodic and semantic memory, scoped per Agent and optionally per Space
- **MCP protocol** — Agents interact through a Model Context Protocol server

### Obsidian Sync
- **Community plugin** — install [AgentWiki Sync](https://github.com/NeoMei/agentwiki-sync)
  from the Obsidian community store or GitHub
- **Git-style workflow** — Status, Pull, and Push map vault directories to a Space
- **Safe device authorization** — connect through a one-time browser flow; manage and
  revoke devices from the web Integrations page

### Codebase Documentation
- **Git ingestion** — clone and index a repository into structured wiki pages
- **Source provenance** — track which commit, file and run produced each piece of knowledge
- **Ingest pipeline** — queued, lease-based processing with crash recovery

### Administration
- **Platform admin** — super admin dashboard with user stats, search/filter/lock/delete

- **Space roles** — Owner, Admin, Editor, Viewer with clear hierarchy
- **Member management** — invite users by email and manage each Agent's Reader / Editor / Publisher Space role
- **Review queue** — approve, reject or revert proposed changes with status tracking
- **Multi-language** — full Chinese/English UI with persistent language preference

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | NestJS, TypeScript |
| Frontend | React, Vite, Tailwind CSS |
| Database | PostgreSQL, Prisma ORM |
| Cache/Queue | Redis |
| Realtime | Socket.io |
| Editor | CodeMirror 6 |
| AI Assist | OpenCode (server-side embedded) |

## Self-hosting (Optional)

### Prerequisites

- Node.js 24 or 26 (Node 24 is the default development and container baseline)
- pnpm >= 11
- PostgreSQL >= 16
- Redis

### Installation

```bash
git clone https://github.com/NeoMei/AgentWiki.git
cd AgentWiki/agentwiki
pnpm install
```

### Configuration

Copy the env template and fill in your values:

```bash
cp .env.example .env
```

Key environment variables:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/agentwiki
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
APP_SECRET=your-app-secret

# AI Assist (optional — enables server-side OpenCode editing helper)
OPENCODE_BIN=opencode
ANTHROPIC_API_KEY=your-key   # or OPENAI_API_KEY, OPENROUTER_API_KEY, etc.

# Worker process role
PROCESS_ROLE=all   # 'api' | 'worker' | 'all'
```

### Database Setup

```bash
cd apps/server
npx prisma migrate deploy
npx prisma generate
```

### Development

```bash
# From project root — starts API, Worker and Vite together
pnpm dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3000/api
- Health check: http://localhost:3000/api/health

### Production Build

```bash
pnpm build
```

## Local knowledge sync

Local knowledge sync lets a coding Agent turn a local repository or document folder
into reviewable AgentWiki knowledge. It installs the shared Agent Skill and the single
`agentwiki` MCP gateway; it does **not** scan or upload files during installation.

### Install

1. In AgentWiki, create an Agent, then open its access page and choose the target Space
   plus one role: **Reader**, **Editor**, or **Publisher**.
2. Paste the complete generated instruction into your local coding Agent. It installs
   the exact plugin version and creates or updates the one `agentwiki` MCP connection.
3. Ask the Agent to inspect and scan a local folder. Review its local preview and
   explicitly confirm the sync before anything is sent to AgentWiki.

The generated installation code is single-use and expires after 10 minutes. It is not
a reusable API key. The public package page is
[`@neomei/agentwiki-local-sync`](https://www.npmjs.com/package/@neomei/agentwiki-local-sync).
Source and generated instructions target 0.6.0; the unified `onboard` command is the only recommended Agent connection path. Exchanging its one-time code atomically creates or updates the Space Grant, then creates an identity-only Credential bound to that Grant. There is no second Credential authorization or custom-scope path.

### Example local workflow

The installed gateway exposes one tool set:

- `wiki_*` for remote AgentWiki operations
- `local_*` for local inspection without upload
- `knowledge_*` for prepare, preview, confirmed sync, and pull workflows

Use `local_scan_sources`, then `knowledge_prepare`. Review its preview and call
`knowledge_confirm_and_sync` only after explicit confirmation in the current conversation.

See the hosted [Usage Guide](https://agentwiki.quukk.com/guide) for the complete guided flow and screenshots.

### Data and security boundary

- **Stays local by default:** source files, source paths, the local preview, connection
  metadata, and the locally stored credential. The credential is written under
  `~/.agentwiki/` with owner-only permissions.
- **Sent only after confirmation:** the prepared knowledge envelope, its relative paths
  and provenance, and the target Space selection. `knowledge_prepare` stays local;
  `knowledge_confirm_and_sync` is the confirmed upload step.
- **Remote model boundary:** Local Agent may use its own model provider during preparation. A non-local provider is disclosed and requires explicit consent before local content can be processed through it. Do not include secrets in source material or in generated code-analysis evidence.

### Supported Agents

| Agent | Connection method | Status |
| --- | --- | --- |
| Codex | Atomic user config entry named `agentwiki` | Supported |
| Claude Code | Atomic `~/.claude.json` entry named `agentwiki` | Supported |
| OpenCode | Version-aware user config entry named `agentwiki` | Supported |
| Other MCP-compatible Agents | Install the package's single `agentwiki` stdio gateway | Compatible; validate with `doctor` |

## Connecting an Agent

AgentWiki Agents use separate connection identities bound to Space authorizations. The
connection flow selects the Space and role once, then atomically creates or updates the
Space Grant and binds an identity-only Credential when the one-time code is exchanged.

### 1. Create an Agent

```bash
curl -X POST $BASE/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Agent"}'
```

### 2. Create a Unified Connection

In the Agent access page, choose a Space and one Agent role:

- `reader` — read Spaces, pages, graph, sources, runs, and review status
- `editor` — Reader capabilities plus page, graph, source, and run writes; writes normally enter human review
- `publisher` — Editor capabilities plus Memory and scoped auto-publish eligibility

The Agent never receives `review:decide` or member-management permission. Publisher
does not modify the Space policy; auto-publish occurs only when every existing governance
gate permits it.

Or via API:

```bash
curl -X POST $BASE/agents/AGENT_ID/local-sync-installations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"spaceId":"SPACE_ID","role":"editor","pluginVersion":"0.6.0"}'
```

Paste the returned one-time instruction into Codex, Claude Code, or OpenCode. On
exchange, AgentWiki writes the `editor` Credential and `editor` Space Grant together.

### 3. Agent API Connection

Scripts or non-MCP integrations use the same connection authorization flow. Exchange the
one-time code returned above; the exchange atomically creates the role-matched Credential
and Space Grant and returns the one-time `apiKey`.

```bash
curl -X POST $BASE/integrations/local-sync/exchange \
  -H "Content-Type: application/json" \
  -d '{"code":"AW-ONE-TIME-CODE"}'
```

Save the returned `apiKey` (`agk_...`). AgentWiki does not provide a second manual
Credential-signing route.

### 4. Call the API

```bash
# Read a page
curl "$BASE/pages/PAGE_ID" -H "Authorization: Bearer agk_..."

# Propose a change (enters review queue)
curl -X PATCH "$BASE/pages/PAGE_ID" \
  -H "Authorization: Bearer agk_..." \
  -H "Content-Type: application/json" \
  -d '{"content":"# Updated content"}'
```

### Server-derived Scopes

| Scope | Description |
|-------|-------------|
| `spaces:read` | List and inspect authorized Spaces |
| `pages:read` | Read pages |
| `pages:write` | Create/edit pages |
| `sources:read` | Read code sources |
| `sources:write` | Add code sources |
| `runs:read` | Read ingest runs |
| `runs:write` | Start ingest runs |
| `review:read` | Read review queue |
| `review:auto-publish` | Publish without review |
| `memory:read` | Read agent memory |
| `memory:write` | Write agent memory |
| `graph:read` | Read knowledge graph |
| `graph:write` | Modify graph relations |

## Permission Model

`AgentGrant.role` is the sole persisted permission fact. Agent permissions pass through
the following live gates:

```
Active Credential bound to exactly one Grant
        +
Space Grant Role → Derived Scopes
        ∩
Agent State ∩ Space Policy ∩ Domain Authorization
```

Only `reader`, `editor`, and `publisher` are accepted for Agent access. Legacy
`viewer`, `full`, `permissionPreset`, `approvalMode`, and client-supplied scope lists
are rejected. Human Space roles remain a separate Owner / Admin / Editor / Viewer model.
Reader onboarding ends with a read-only pull; only Editor and Publisher perform the
initial write sync. Auto-publish re-reads and row-locks the live Credential, Agent owner,
bound Agent Grant, and Space before publishing, so a concurrent revoke, expiry,
deactivation, role downgrade, deletion, or policy downgrade falls back to `pending_review`.

**Space roles for humans:**
- **Owner** — full control, can transfer ownership, cannot be removed
- **Admin** — manage human members; may mutate an Agent grant only when also owning that Agent; cannot delete Space or grant Owner
- **Editor** — create and edit pages
- **Viewer** — read-only access

## Project Structure

```
agentwiki/
├── apps/
│   ├── server/              # NestJS backend
│   │   ├── src/
│   │   │   ├── core/        # auth, space, page, agent, review, search
│   │   │   ├── assist/      # OpenCode AI editing assistant
│   │   │   ├── knowledge-pipeline/  # code ingestion & indexing
│   │   │   ├── mcp/         # MCP protocol server
│   │   │   └── memory/      # agent memory service
│   │   └── prisma/          # schema and migrations
│   ├── client/              # React + Vite frontend
│   │   └── src/
│   │       ├── components/  # shared UI (PageTree, MarkdownWorkspace, etc.)
│   │       ├── features/    # page, space, agent, review, search, about
│   │       └── context/     # auth, language
│   └── shared/              # shared types and utilities
├── packages/
│   ├── local-sync/          # @neomei/agentwiki-local-sync CLI and gateway
│   └── sync-protocol/      # @neomei/agentwiki-sync-protocol shared contract
├── deploy/                  # systemd units and deployment scripts
└── scripts/                 # dev runner and utilities
```

## Testing

```bash
# Server tests (Jest)
pnpm --filter @agentwiki/server test

# Client tests (Vitest)
pnpm --filter @agentwiki/client test

# Lint
pnpm lint

# Type check
pnpm typecheck
```

## Deployment

AgentWiki uses direct deployment with systemd (no Docker for the application):

1. Before replacing application files or running migrations, create and verify a
   PostgreSQL custom-format backup and an application rollback archive.
2. Build and test the exact release commit: `pnpm build && pnpm test`.
3. Pack `@neomei/agentwiki-sync-protocol@0.2.0` and
   `@neomei/agentwiki-local-sync@0.6.0`, then run
   `pnpm test:package:local-sync-clean-install`. Confirm the unchanged protocol
   package is already available, then publish the audited local-sync tarball.
4. Run database migrations: `cd apps/server && npx prisma migrate deploy`.
5. Configure three systemd services (templates in `deploy/systemd/`):
   - `agentwiki-api.service` — NestJS API server
   - `agentwiki-worker.service` — background job worker
   - `agentwiki-frontend.service` — static file server for the built frontend

The 0.5.0 role migration deliberately resets every existing Agent Credential and Grant
role to `reader`; it never infers a new role from legacy scopes. The 0.6.0 onboarding
protocol requires the matching 0.6.0 client. Treat rollback as a coordinated restore of
the verified database backup and matching application archive, not as a schema-only
downgrade.

See `deploy.sh` for an automated deployment script.

## License

Private project. All rights reserved.

## Author

**NeoMei** — ffdeml@gmail.com
