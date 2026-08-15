<!-- codex-memory:template=task-brief:v1 -->

# unified-agentwiki-mcp-fix

## 目标

消除 Agent Credential 与“本地知识同步”产生的两套互相覆盖的 MCP 接入指令，使所有本地 Agent 只使用一个名为 `agentwiki` 的统一 gateway。

## 当前状态

- 0.3.7 实现、聚焦测试、全仓测试、typecheck、lint、生产构建和 npm tarball 检查均已完成。
- 三轮独立只读代码评审已完成：第三轮结论 ready to merge，Critical/Important 全部闭环；其剩余 Minor 项（瞬时故障误删 receipt、重放分支吞 rollback 错误、错误掩盖、命名、JWT_SECRET 轮换说明、文档计数）也已修复或补充。
- 服务端 exchange 幂等改为数据库唯一认领（`AgentCredential.localSyncInstallationId`，迁移 `20260815010000_add_local_sync_installation_claim`），API key 由 HMAC 确定性派生；Redis receipt 只存元数据且 TTL 受安装码剩余寿命约束。
- 最新门禁：runtime 69 pass/39 skip、server 517、client 156、sync-protocol 22、local-sync 358；typecheck、lint、build、diff check 全过。
- Git 推送/合并、生产部署、npm 发布和三客户端公网 E2E全部完成。
- 2026-08-15 生产部署 0.3.7 完成：备份 `pre-unified-mcp-0.3.7-20260815160411.dump`（SHA-256 `6dafe895...`）校验通过；33 个迁移全部应用，`localSyncInstallationId` 列+唯一索引核验存在；三服务 active、公网 health 200、API smoke 18 项、UI 路由 smoke 25 条全过。
- 2026-08-15 npm 发布 0.3.7 完成（latest 确认，shasum 与本地一致）。
- 2026-08-15 三客户端公网 E2E 全过：codex PASS、claude PASS、opencode PASS（npm 公网包 + 生产服务器 + 隔离 HOME，fixture 自动清理）。

## 已实现范围

- 普通 Credential 创建后只显示一次 API Key，并说明 API/脚本用途，不再生成 direct MCP。
- 已有 Agent 的一次性安装指令改为精确版本 `onboard --code --protocol ndjson --agent auto`。
- attach 模式确认配置迁移后交换安装码，复用统一 gateway 安装、验证、回滚和 revoke 流程，不创建 Agent、不扫描、不同步。
- Codex、Claude、OpenCode 只保留一个 `agentwiki` MCP；配置迁移和卸载使用精确所有权判断。
- 活动 UI、服务端指令、README、Skill、环境默认值和契约门禁统一为 0.3.7 单 gateway。

## 完成条件

- 独立评审无未解决 Critical/Important 问题。（已满足）
- 验证报告与项目记忆提交完成。（本轮提交）
- 外部发布与三客户端/生产 E2E 均已完成，任务收口。
