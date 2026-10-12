# 证据与入口

- 工作树：`/Users/neomei/.codex/worktrees/template-layout-plane/AgentWiki `（末尾空格）。所有 Git 命令显式 --work-tree 指向此处，不修改共享配置。
- 本地模板目录：http://127.0.0.1:5187/spaces/preview/new?from=collaboration
- 本地启动向导：http://127.0.0.1:5187/spaces/preview/collaboration/templates/coding/start
- 本地模板管理：http://127.0.0.1:5187/spaces/preview/settings/page-templates
- 本地协作运行：http://127.0.0.1:5187/spaces/preview/collaboration/runs/design-run
- 本地文档：http://127.0.0.1:5187/pages/overview
- 本地看板：http://127.0.0.1:5187/spaces/preview/taskboard
- 运行器：`/tmp/agentwiki-template-design/`；端口 5187，真实源码 + 真实系统 seed + 合成 API，Socket 隔离。
- 最终审查报告：`/Users/neomei/.codex/visualizations/2026/10/12/01a130d1-6332-7282-96eb-8a5399507e3f/agentwiki-template-redesign/audit/audit-report.md`。
- 最终日志：`/Users/neomei/.codex/visualizations/2026/10/12/01a130d1-6332-7282-96eb-8a5399507e3f/agentwiki-template-redesign/audit/audit-final-client.log`（2254 pass）、`audit-final-typecheck.log`、`audit-final-eslint.log`、`audit-final-build.log`。
- 追加截图：同目录 `audit-catalog-final-desktop.png`、`audit-configure-*.png`、`audit-roles-mobile.png`、`audit-wizard-confirm-*.png`、`audit-wizard-final-*.png`、`audit-manager-*.png`、`audit-document-mobile.png`、`audit-editor-mobile.png`。
- 预览 harness 备份：同目录 `harness/`。首版截图/日志在其上级目录，首版709测试仅是早期证据，最终以2254为准。
- 三轮独立审查：scope_audit_round1/code_audit_round1/validation_audit_round1、audit_round2（含CSS子审）、audit_round3；最后一轮独立159测试通过。
- node_modules 为原检出依赖符号链接，不纳入提交；原检出资料未更改。
