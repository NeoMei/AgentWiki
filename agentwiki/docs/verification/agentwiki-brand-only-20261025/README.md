# AgentWiki brand-only update (2026-10-25)

The public brand is localized as **天枢** in Chinese and **AgentWiki** in English. The approved minimalist Chinese-knot mark remains the visual logo; the English UI contains no `Tianshu` spelling.

## Source and validation

- Logo integration commit: `d81994d44179064b90562aab1ae10f4ee08df05f`.
- Brand-only naming commit: `d242c63444705e3d8945424ab952c92c6e5d0e36`.
- Client build passed; initial JavaScript was `550514/551000` bytes.
- Six related client test files passed: 70 tests.
- Browser checks passed at 320px local, desktop local, and 390px production widths. No horizontal overflow was observed.
- Production HTML and four PNG/SVG entry assets matched the local build byte-for-byte. Production title is `天枢` in Chinese and `AgentWiki` in English; the English DOM contains no `Tianshu` spelling.
- Production API health: `status`, `database`, `redis`, `auditPersistence`, and `attachmentStorage` all `ok`.

## Deployment and rollback

- Paired backup: `/var/backups/agentwiki/tianshu-logo.XDki5U2f`.
- Deployed frontend manifest: `/var/backups/agentwiki/tianshu-logo.XDki5U2f/deployed-frontend-manifest.json`.
- Previous frontend dist retained at `/root/agentwiki/apps/client/dist.before-agentwiki-only-d242c634`.
- Only `agentwiki-frontend.service` was restarted; API and Worker remained active after the deployment. Existing immutable client assets were retained for open tabs and rollback.

## Logo assets

The approved mark was extracted with imagegen from the user-approved Chinese-knot concept, then exported as transparent PNGs at 256px (brand), 64px (favicon), and 180px (touch icon). The legacy favicon.svg wraps the PNG rather than claiming to be vector artwork. The active website asset paths use the `agentwiki-` prefix; older immutable `tianshu-` assets remain retained only for already-open tabs and rollback compatibility. The extraction prompt is saved alongside this record.
