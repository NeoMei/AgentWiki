# AgentWiki

A knowledge base system designed for **people and AI Agents**. Write in Markdown, connect information through a knowledge graph, search semantically, and let Agents participate in your knowledge workflow with fine-grained permissions.

> **v0.3.1** — Unified agent self-service onboarding with Device Auth, single gateway MCP, and deterministic knowledge workflows.


## Hosted Service

Use AgentWiki immediately without provisioning PostgreSQL, Redis, or your own server:

- [Open AgentWiki](https://agentwiki.quukk.com)
- [Usage Guide](https://agentwiki.quukk.com/guide)

Create an account to start a Space, invite collaborators, and connect local Agents such as Codex, Claude Code, and OpenCode. Self-hosting remains available below for private deployments and development.

## Features

### Wiki & Editor
- **Obsidian-style Live Preview** — edit Markdown with inline formatting visible, no split-pane switching
- **Hierarchical page tree** — organize pages with parent-child relationships, drag to reorder and re-nest
- **Wiki-links & anchors** — `[[Page Name]]` resolves to internal pages; headings generate anchor links
- **Version history** — every save creates a version; restore any previous state with one click
- **Real-time collaboration** — authenticated WebSocket sessions sync edits across users

### Knowledge Graph
- **Semantic relationships** — connect pages with typed relations (supports, contradicts, extends...)
- **Visual exploration** — interactive graph view with node/edge inspection
- **Evidence & provenance** — every relationship tracks its source, run and confidence level

### Semantic Search
- **Vector-powered** — goes beyond keyword matching with embedding-based relevance
- **Space-scoped** — search respects your access boundaries
- **Text fallback** — degrades gracefully when embeddings are offline

### Agent Integration
- **Independent identity** — Agents have their own credentials (`agk_...`), not shared user tokens
- **Three-layer permissions** — credential scopes (global) ∩ grant scopes (per-space) ∩ role gates
- **Review workflow** — Agent writes enter a ChangeSet for human approval before publishing
- **Per-space scope presets** — quickly configure Viewer / Editor / Reviewer / Full access per Agent per Space
- **Memory** — episodic and semantic memory, scoped per Agent and optionally per Space
- **MCP protocol** — Agents interact through a Model Context Protocol server

### Codebase Documentation
- **Git ingestion** — clone and index a repository into structured wiki pages
- **Source provenance** — track which commit, file and run produced each piece of knowledge
- **Ingest pipeline** — queued, lease-based processing with crash recovery

### Administration
- **Platform admin** — super admin dashboard with user stats, search/filter/lock/delete

- **Space roles** — Owner, Admin, Editor, Viewer with clear hierarchy
- **Member management** — invite users by email, manage Agent grants with scope checkboxes
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
into reviewable AgentWiki knowledge. It installs a small local MCP server and shared
Agent Skill; it does **not** scan or upload files during installation.

### Install

1. In AgentWiki, create an Agent, grant it access to the target Space, then open the
   Agent details page and select **Generate local sync instructions**.
2. Paste the complete generated instruction into your local coding Agent. It installs
   the exact plugin version, creates the MCP connection, and runs `doctor`.
3. Ask the Agent to inspect and scan a local folder. Review its local preview and
   explicitly confirm the sync before anything is sent to AgentWiki.

The generated installation code is single-use and expires after 10 minutes. It is not
a reusable API key. The public package page is
[`@neomei/agentwiki-local-sync`](https://www.npmjs.com/package/@neomei/agentwiki-local-sync).
Source and generated instructions target 0.3.1; the unified onboarding command is the only recommended Agent connection path. Older releases remain
the public `latest` only after npm WebAuthn approval.

### Example local workflow

```bash
# Verify the connection, local adapters, and permissions.
agentwiki-local-sync doctor

# Inspect a local folder without uploading anything.
agentwiki-local-sync inspect --path /absolute/path/to/source

# Prepare a preview. This runs locally and does not upload data.
agentwiki-local-sync scan --path /absolute/path/to/source --space <space-id>

# Review the returned preview, then upload it only after explicit confirmation.
agentwiki-local-sync sync --preview <preview-id> --confirm
```

See the hosted [Usage Guide](https://agentwiki.quukk.com/guide) for the complete guided flow and screenshots.

### Data and security boundary

- **Stays local by default:** source files, source paths, the local preview, connection
  metadata, and the locally stored credential. The credential is written under
  `~/.agentwiki/` with owner-only permissions.
- **Sent only after confirmation:** the prepared knowledge envelope, its relative paths
  and provenance, and the target Space selection. `scan` and preview generation do not
  upload data; `sync --confirm` is the upload step.
- **Remote model boundary:** Local Agent may use its own model provider during preparation. A non-local provider is disclosed and requires explicit consent before local content can be processed through it. Do not include secrets in source material or in a codebase-memory summary.

### Supported Agents

| Agent | Connection method | Status |
| --- | --- | --- |
| Codex | User MCP entry installed with `codex mcp add` | Supported |
| Claude Code | User MCP entry installed with `claude mcp add --scope user` | Supported |
| OpenCode | User MCP entry in its user configuration | Supported |
| Other MCP-compatible Agents | Register the package's stdio MCP command manually | Compatible; validate with `doctor` |

## Connecting an Agent

AgentWiki Agents use separate API credentials with scoped permissions. Here's how to connect one:

### 1. Create an Agent

```bash
curl -X POST $BASE/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Agent","approvalMode":"always-review"}'
```

### 2. Grant Space Access

In the Space Members page, expand the Agent's scope panel and pick a preset (Viewer, Editor, Reviewer, Full), or fine-tune individual scopes.

Or via API:

```bash
curl -X PUT $BASE/agents/AGENT_ID/grants/SPACE_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"editor","scopes":["pages:read","pages:write","graph:read"]}'
```

### 3. Create a Credential

```bash
curl -X POST $BASE/agents/AGENT_ID/credentials \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"default","scopes":["pages:read","pages:write"]}'
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

### Available Scopes

| Scope | Description |
|-------|-------------|
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

Permissions are the intersection of three layers:

```
Credential Scopes (global capability ceiling)
        ∩
Grant Scopes (per-space restriction; empty = inherit all credential scopes)
        ∩
Role Gate (editor/viewer — derived from scopes: any write scope = editor)
```

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

1. Build the project: `pnpm build`
2. Run database migrations: `cd apps/server && npx prisma migrate deploy`
3. Configure three systemd services (templates in `deploy/systemd/`):
   - `agentwiki-api.service` — NestJS API server
   - `agentwiki-worker.service` — background job worker
   - `agentwiki-frontend.service` — static file server for the built frontend

See `deploy.sh` for an automated deployment script.

## License

Private project. All rights reserved.

## Author

**NeoMei** — ffdeml@gmail.com
