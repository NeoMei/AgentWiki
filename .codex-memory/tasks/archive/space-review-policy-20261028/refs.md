# 引用

- canonical: /Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki
- 基线dce0f764；production v0.12.64 / 190ba1b3。
- UI：Dashboard、SpaceView、SpaceSettings；现有审批规范 api/space-types.ts。
- root负责共享SpaceReviewPolicy组件/事件/标题入口；backend代理负责服务器/schema/onboard；UX代理负责Dashboard/Settings。

- 本地全套日志 /tmp/agentwiki-space-review-full.log，独立exit文件为0。
- /tmp/agentwiki-space-review-{client-final,types-final,lint-final,build-final}.log。
- Chrome回执 /tmp/agentwiki-space-review-qa/receipt.json，截图create-desktop.png/settings-desktop.png/header-mobile.png；preview/browser脚本在/tmp，实际业务服务未写入。
- 后端专项137/137、权限/模块322/322、PG41/41、corpus6/6；全套结果优先，不与专项重复累加。
