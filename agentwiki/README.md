# AgentWiki

A knowledge base system designed for **people and AI Agents**. Write in Markdown, connect information through a knowledge graph, search semantically, and let Agents participate in your knowledge workflow with fine-grained permissions.

> **v0.5.0** — Unified `reader | editor | publisher` Agent access packages for the AgentWiki gateway and reviewable knowledge workflows.


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
- **Unified Agent roles** — choose Reader, Editor, or Publisher once; the server derives matching Credential and Space Grant scopes
- **Review workflow** — Agent writes enter a ChangeSet for human approval before publishing
- **Least-privilege intersection** — effective access is limited by Credential role/scopes, Space Grant role/scopes, Agent state, Space policy, and domain authorization
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
Source and generated instructions target 0.5.0; the unified `onboard` command is the only recommended Agent connection path. Exchanging its one-time code atomically creates the matching Credential and Space Grant. Ordinary Agent credentials remain available for APIs, scripts, and external systems, but do not create another MCP connection.

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

AgentWiki Agents use separate identities and role-derived credentials. The recommended
connection flow selects the Space and role once, then atomically creates the matching
Credential and Space Grant when the one-time code is exchanged.

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
  -d '{"spaceId":"SPACE_ID","role":"editor","pluginVersion":"0.5.0"}'
```

Paste the returned one-time instruction into Codex, Claude Code, or OpenCode. On
exchange, AgentWiki writes the `editor` Credential and `editor` Space Grant together.

### 3. Optional Manual API Credential

For scripts or non-MCP integrations, create a role-limited Credential. The server derives
its exact scopes; custom scopes are rejected. A matching Space Grant role is still required.

```bash
curl -X POST $BASE/agents/AGENT_ID/credentials \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"default","role":"editor"}'
```

Save the returned `apiKey` (`agk_...`) — it's shown only once.

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

Agent permissions are the intersection of all current authorization gates:

```
Credential Role + Derived Scopes
        ∩
Space Grant Role + Derived Scopes
        ∩
Agent State ∩ Space Policy ∩ Domain Authorization
```

Only `reader`, `editor`, and `publisher` are accepted for Agent access. Legacy
`viewer`, `full`, `permissionPreset`, `approvalMode`, and client-supplied scope lists
are rejected. Human Space roles remain a separate Owner / Admin / Editor / Viewer model.

**Space roles for humans:**
- **Owner** — full control, can transfer ownership, cannot be removed
- **Admin** — manage all members and Agent grants, cannot delete Space or grant Owner
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
3. Run database migrations: `cd apps/server && npx prisma migrate deploy`.
4. Configure three systemd services (templates in `deploy/systemd/`):
   - `agentwiki-api.service` — NestJS API server
   - `agentwiki-worker.service` — background job worker
   - `agentwiki-frontend.service` — static file server for the built frontend

The 0.5.0 role migration deliberately resets every existing Agent Credential and Grant
role to `reader`; it never infers a new role from legacy scopes. The 0.5.0 onboarding
protocol is incompatible with 0.4.0 clients. Treat rollback as a coordinated restore of
the verified database backup and matching application archive, not as a schema-only
downgrade.

See `deploy.sh` for an automated deployment script.

## License

Private project. All rights reserved.

## Author

**NeoMei** — ffdeml@gmail.com
