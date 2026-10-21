# 当前目标

Agent 扫描目录总结失败与同一 Session 后续会话丢失上下文已修复，候选提交 `3f0e9896` 已部署到生产。

# 范围 / 不做

范围为 OpenCode v2 目录 MCP/工具声明与权限配置、Session 失败/取消终态回放及对应测试。生产目标固定为 `root@113.249.120.24:/root/agentwiki`；不从历史 checkout 发布，不打印生产环境密钥。

# 当前状态

- 工作树 `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`，分支 `codex/agent-autochat-external-opencode`；候选守卫通过，提交已同步到 `origin`。
- OpenCode v2 现在声明 `capabilities.tools`、`mcp.servers`、数组权限规则；Session execution context 回放 `done/failed/cancelled`，失败错误已脱敏。
- assist 相关 443 个测试、构建、typecheck、lint通过；完整测试受当前环境缺失 `PAGE_TEMPLATE_TEST_DATABASE_URL` 阻塞，不能宣称全量通过。
- 生产 `root@113.249.120.24:/root/agentwiki` 已完成 staged build、65 个迁移无待执行项和原子切换；三服务 active、内外健康接口五项均 ok、前端 HTTP 200。
- 协调备份 `/var/backups/agentwiki/assist-session-v01256.y9kniutw` 已验证；旧应用保留在 `/root/agentwiki-previous-20261022040109`。

# 稳定约束

Git在候选工作树中操作，发布前必须通过 `scripts/agentwiki-release-guard.mjs`。生产发布须使用显式 `deploy.sh 113.249.120.24 root`，先做协调数据库/附件备份并保留旧应用树；禁止从历史 checkout 发布或猜测 SSH 密码。

# 关键索引

- `AGENTWIKI_RELEASE_CANDIDATE`
- `apps/server/src/assist/opencode.runner.ts`
- `apps/server/src/assist/assist-session.service.ts`
- `docs/verification/generic-mcp-onboarding-20261018/release-execution-plan.md`
- `deploy.sh`

# 风险 / 下一步

生产部署和服务回读已完成；目录扫描与同一 Session 的真实浏览器端到端回归仍需在登录后的用户界面执行，当前证据覆盖候选代码、部署文件哈希、服务健康和公网 HTTP。
