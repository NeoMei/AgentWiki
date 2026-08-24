# Obsidian Navigation Consolidation Design

## Goal

Remove the standalone “Connect Obsidian” destination from AgentWiki’s global desktop and mobile navigation because the Usage Guide already provides the canonical Obsidian entry.

## Scope

- Remove the `/guide/obsidian` item from the desktop `GlobalNavigation` destination list.
- Remove the corresponding item from the mobile `Navbar` menu.
- Treat every `/guide` route, including `/guide/obsidian`, as part of the single “Usage Guide” global destination.
- Keep the `/guide/obsidian` route, the Usage Guide’s “Obsidian Plugin” entry, the Profile shortcut, installation instructions, connection-code flow, and device management unchanged.
- Remove the now-unused global-navigation icon/import and update focused navigation tests.

## User Flow

1. The user selects “Usage Guide” from the global navigation.
2. Inside the guide, the user selects “Obsidian Plugin”.
3. The existing `/guide/obsidian` page continues to provide install, connect, and device-management actions.
4. While that page is open, the global “Usage Guide” destination remains active.

Direct bookmarks, the legacy `/settings/integrations` redirect, and login return paths to `/guide/obsidian` continue to work.

## Verification

- Desktop navigation does not render “Connect Obsidian”.
- Mobile navigation does not render “Connect Obsidian”.
- “Usage Guide” is active on both `/guide` and `/guide/obsidian`.
- The Usage Guide still links to `/guide/obsidian`.
- Existing Obsidian guide and safe-return tests remain green.
- Client typecheck, focused tests, and production build pass.

## Non-goals

- No route removal or redirect change.
- No change to Obsidian installation, connection, credentials, or device APIs.
- No change to the Profile shortcut or the guide’s internal navigation.
