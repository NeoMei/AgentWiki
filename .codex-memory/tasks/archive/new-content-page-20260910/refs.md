# 参考与证据

- 实现：agentwiki/apps/client/src/features/page-templates/NewContentPage.tsx、NewPageDialog.tsx、newContentNavigation.ts。
- 回归：NewContentPage.spec.tsx、NewContentPage.route.spec.tsx，及既有 Space/协作/工作台/模板测试。
- 本地证据：/Users/neomei/.codex/recovery/agentwiki-new-content-20260910/，含 Chrome 截图、隔离 fixture 脚本/result.json、客户端全量测试日志和构建日志。
- 过程边界：首次新增 3 测试在旧弹窗实现下失败，旧 33 测试通过；入口旧断言随路由迁移更新。浏览器 fixture 初轮误拦截 /src/api/* 已修正，最终仅匹配 /api/。
- 工作树：/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/new-content-page-20260910。Git 命令必须显式 --work-tree。

- 发布验收：agentwiki/docs/verification/new-content-v0111-release.md
- GitHub Release：https://github.com/NeoMei/AgentWiki/releases/tag/v0.11.1
- 生产证据：私有目录production-ui-result.json、v0111-gates-closed.json、v0111-source-postflight.json。
