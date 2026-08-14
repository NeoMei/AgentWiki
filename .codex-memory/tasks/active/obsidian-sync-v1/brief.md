# Obsidian Sync v1 主项目交付

## 目标

在 AgentWiki 主项目交付 AgentWiki Sync Obsidian 插件所需的三项服务端能力，使插件能从真实 AgentWiki 接入并同步人类 Vault。

## 交付物

1. 浏览器兼容协议包 `@neomei/agentwiki-sync-protocol`：浏览器 ESM、TypeScript 类型、运行时 Schema、canonical serialization 与 hash。
2. 人类设备身份：一次性连接码、exchange、凭据、session、activate、revoke 与用户端设备管理。
3. `/api/sync/v1` 路由与数据库迁移：head、分页 Snapshot/Delta、Push session 生命周期、规范化 Page rows、sidecar、bigint 指标、revision retention、keyset cursor。

## 权威契约

- `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/docs/contracts/agentwiki-obsidian-sync-api-v1.md`
- `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/docs/contracts/agentwiki-main-project-handoff.md`

契约 53 项验收测试全部必须满足；Release A / Release B 两阶段迁移顺序不可颠倒。

## 范围 / 不做

- 只改 AgentWiki 主项目 `agentwiki/` 子树；不修改 `docmost/mnemon/openwiki/outline/swarmvault` gitlink。
- 不破坏现有 local-sync Snapshot/Delta 语义；不恢复已退役编译器路径。
- AgentCredential 不得调用人类设备发布端点；人类设备凭据不得调用 Agent/Review 管理接口。

## 当前状态

- 分支 `codex/obsidian-sync-v1` 已建立。
- M1 协议包 `@neomei/agentwiki-sync-protocol`：canonical/hash/Unicode 15.1 full folding/normalize/parse/Schema/batching，21 测试含契约 3.5 全部 fixture，双构建（ESM+CJS）供浏览器与服务端。
- M2 人类设备身份：HumanDeviceCredential/Family/Installation/ServerInstanceIdentity 模型、连接码、exchange（含 requestHash 幂等恢复）、session、activate、revoke、设备管理、exchange 限流。
- M3 sync v1：Release A/B 两阶段迁移、规范化 Page rows/sidecar/blob/bigint 指标、统一 revision 写入器（含 legacy 双写 + supersede）、Snapshot/Delta/head/spaces 读路径、Push session 生命周期、回填脚本、local-sync 兼容适配器。
- page 与 review ChangeSet 写入路径均已接入统一 revision 写入器。
- 补充 revision retention cleanup、instance rotate 命令、exchange 限流、真实数据库迁移集成测试。
- 全量 server 测试 496 通过；协议包 21 测试通过；typecheck/build 通过；真实数据库迁移测试通过。
- 尚未完成：契约 17 节 53 项验收的端到端/并发/故障注入自动化测试，协议包 npm 发布，以及插件仓库从本地协议副本切换到已发布包（需跨仓协作与 npm 凭据）。
