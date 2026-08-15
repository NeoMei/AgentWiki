# Obsidian Plugin Server-Side Fix Spec

> Source: AgentWiki-Obsidian plugin real E2E integration (2026-08-15/16)
> Blocking: P0 — without this, Obsidian users cannot complete first connection

## Problem

Server already implements `POST /api/integrations/obsidian/installations` (create one-time connection code), but the web IntegrationsPage (`/settings/integrations`) only shows MCP endpoint, tools, and agent permissions. There is NO UI entry for users to generate an Obsidian connection code.

Verified in production: users open `/settings/integrations`, see the MCP section and agent access section, scroll to bottom — no Obsidian content anywhere. Users can only get a code by manually calling the API via browser DevTools console. Ordinary users are completely blocked.

## Existing Backend APIs (no changes needed)

| Method | Path | Auth |
|---------|------|------|
| POST | /api/integrations/obsidian/installations | Human JWT |
| GET | /api/integrations/obsidian/credentials | Human JWT |
| DELETE | /api/integrations/obsidian/credentials/:id | Human JWT |
| DELETE | /api/integrations/obsidian/installations/:id | Human JWT |

## Fix Requirements

### 1. Add Obsidian Device Sync section

Add between MCP and agent access sections in `IntegrationsPage.tsx`:
- Header with icon: Obsidian Device Sync
- Generate Connection Code button
- Connected Devices list

### 2. Connection code modal

On Generate click:
1. Call `POST /api/integrations/obsidian/installations`
2. Show modal with full code (monospace, copyable), 10-min countdown, step guide
3. Code shown only once; cleared on modal close
4. After expiry, show regenerate button

Step guide text:
```
1. Open Obsidian -> Settings -> AgentWiki Sync
2. Server address: {origin}
3. Paste the code -> click Connect
```

### 3. Device list

- Call `GET /api/integrations/obsidian/credentials` on page load
- Show deviceName, status (active/provisional/expired/revoked), vaultId (truncated to 8 chars), lastUsedAt (relative)
- Revoke button with confirmation dialog -> `DELETE /api/integrations/obsidian/credentials/:credentialId`

### 4. Security

- Existing CombinedAuthGuard + HumanOnlyGuard already suffice
- Code never in URL, never in localStorage
- Modal clears code from memory on close

## Acceptance Criteria

1. IntegrationsPage shows Obsidian Device Sync section
2. Generate shows code within 3 seconds
3. Code works in Obsidian plugin exchange
4. Device list shows status correctly
5. Revoked device cannot call sync v1 APIs
6. i18n complete (zh-CN, en-US)

## Implementation Location

- Frontend: `apps/client/src/features/integrations/IntegrationsPage.tsx`
- i18n: `apps/client/src/i18n/`
- Backend: none needed
