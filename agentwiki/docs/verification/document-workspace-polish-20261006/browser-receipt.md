# Second-round browser evidence

Product Task1 0b16b9b8, IAB actual API at localhost51894, 2026-10-06. Dedicated disposable folder_test schema, own API/Redis/Vite, no worker/external model.

- Login UI -> actual authorized long document edit. UI task labelled 模拟验收, fixture stream/complete receipt pageUnchanged true.
- Initial diff immediately displays late change after 93 unchanged lines; counts +1/-1. No automatic save/source change.
- Enter expands 93-line context and Enter collapses; aria-expanded true observed then false.
- Whole preview button toggles aria-pressed true then back false, actual DOM labels change.
- Clipboard baseline2597 chars; explicit accept changes late sentence; Meta+Z restores exact whole-string baseline.
- 1440x960 screenshot candidate-desktop.png. 390x844 candidate-mobile.png; document.scrollWidth390, layerleft62/right382/top110/bottom836; no clipping or horizontal overflow. Console warning/error[] after interactions.
- These Task1 observations were on the earlier disposable fixture. Final production notes acceptance and cleanup are recorded below.


## Final production assets — b8c2ddf7

2026-10-06; real IAB UI at owned loopback preview51894 with actual isolated API/DB/Redis, new disposable account/Space/page. Production build completed before the cold tab opened. No browser state injection. Every task was visibly labelled 模拟验收 and completed by guarded local fixture stream/done; no external model.

- Cold page loaded; note filter accessible names include Chinese counts (全部 (2), 未解决 (2), 已解决 (0)). Console warnings/errors empty throughout final tab.
- Selected two separate visible quotes, composed and added notes. No active selection/no body hides the composer. Select all reports2; Resolved filter clears selected to0 and disables send. Return Open preserves0, explicit select-all returns2.
- First real UI dispatch queued one AssistTask containing A+B. Fixture completion returned pageUnchanged=true. UI presented two independent numbered changes, accepted0/2; whole-document comparison closed.
- Explicitly accepted A only: source A changed, source B unchanged; Open1/Resolved1, selected0. B remained awaiting review. Conservative exact-context guard marked B unavailable while nearby A differed. This existing safety rule was not loosened by presentation work.
- One Meta+Z restored all2597 source characters byte-for-byte via editor clipboard comparison. B's original exact context became valid again. Reopen B showed pending, selected0 and send disabled. Explicitly selected B and dispatched the second batch: only B appeared in the actual task payload; no stale A selection.
- Second local fixture completed pageUnchanged=true. Explicit whole-candidate accept resolved B and Open0/Resolved2. One Meta+Z again restored the exact2597-character source. Neither accept saved or published the Page. Note statuses intentionally use existing explicit reopen semantics across editor undo.
- Reopened notes and explicitly selected them for final screenshots. At390x844, document.scrollWidth390, note region left74/right370, clientWidth=scrollWidth294; no horizontal overflow. Responsive drawer and wrapping remained usable. Desktop screenshot is default1280x720; no desktop viewport override retained. Mobile viewport reset and temporary tab closed.
- Screenshots in screenshots/: candidate-desktop/mobile from Task1 interaction; notes-desktop/mobile from final production build. The native quote selection includes preceding blank lines, preserved faithfully in source and quoted note.

Independent code/task/final/scoped reviews are separate receipts under reviews/. Runtime cleanup is recorded in cleanup-receipt.json and acceptance.md. This does not claim live provider, Windows/native IME or multi-user load acceptance.
