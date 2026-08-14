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
- 多轮审查补齐（汇总）：finalize 角色重检、archive 删搜索索引、revert/无 submission page changeset/memory-relation-only changeset 推进 revision、Page 迁移与整空间预检、词法索引同事务、blob GC 与定时维护、deployment seed 启动门禁、session 保留期删除、provisional 过期/撤销区分、sync 错误 envelope 原样返回、changeCount=0 校验、Snapshot/Delta response 字节预算。
- 协议包 `@neomei/agentwiki-sync-protocol@0.1.0` 已发布到 npm，`npm install` 验证导出符号完整；主仓 server 已通过 `workspace:*` 依赖该包。
- 统一 revision 写入器改为 INSERT…SELECT 复制父 rows + 正文按需 upsert + SQL 聚合指标，不再把整个 Space 读入 Node 内存（满足契约 5.1 与验收 12 的有界内存要求），真实 advance 集成测试验证。
- 全量 server 测试 497 通过；协议包 22 测试通过（含 3.5 fixture 公开入口断言）；typecheck/build 通过；6 个真实 PostgreSQL 集成测试通过（迁移非空、A→B→A、legacy DTO 合成、并发 pageId 唯一、并发 session 幂等唯一、真实 advance 复制/归档/指标）。
- 尚未完成：插件仓库从本地协议副本切换到已发布包（跨仓），以及需要真实运行服务的并发 finalize/故障注入/5000 页性能端到端（本会话已覆盖 DB 级唯一性收敛，但 HTTP 并发 finalize 的故障注入需运行中服务）。
