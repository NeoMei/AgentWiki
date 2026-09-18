# AgentWiki v0.11.4

Security patch for Space page creation authorization.

- Page creation now requires the requester to be the Space owner or an actual Space member on every route.
- This applies to empty pages, single-page template instantiation, and composite page creation.
- Super admins retain existing read access, but cannot create pages in Spaces where they have no membership.
- Local Sync and sync protocol versions remain 0.10.0 and 0.6.0. The independent Obsidian Sync release remains 0.5.1.
