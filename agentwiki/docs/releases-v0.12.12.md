# AgentWiki v0.12.12 / Local Sync v0.11.0 发布与部署记录

## 范围

本版本让同一个 Agent 的一个 `agentwiki` Local Sync 网关保存多个 Space 连接。每个连接继续绑定自己的 `spaceId`、Credential 和 Grant；调用按显式 `spaceId` 选取凭据，未知或冲突的 Space 选择会失败并拒绝回落到其他 Space。旧的单连接配置可以迁移读取，新增 Space 采用合并写入并保留其他连接。版本已发布到 GitHub、npm 并部署到生产环境。

应用版本为 `0.12.12`，`@neomei/agentwiki-local-sync` 为 `0.11.0`，`@neomei/agentwiki-sync-protocol` 继续使用已发布的 `0.6.1`。服务端继续接受 `0.9.0`、`0.9.1`、`0.10.0`、`0.10.1`、`0.10.2` 和 `0.11.0`。本次没有 Prisma schema、迁移或同步协议改动。

## 验证收据

- Local Sync：67 个测试文件，942 通过，1 个既有 skip；类型检查和 ESM/CJS 构建通过。
- Client：117 个测试文件，1630 通过；构建通过。
- Server：160 个 Jest suite 通过，2761 通过，4 个既有 skip。
- Runtime：263 通过，1 个既有 skip；数据库回归 216/216 通过，没有数据库 skip。
- Sync protocol：10 个测试文件，140 通过；公开 npm `@neomei/agentwiki-sync-protocol@0.6.1` 与本地包字节一致。
- 版本契约、Registry 冲突门禁、lint 和全量构建通过。Lint 保留 3 条既有 warning，没有 error。
- Local Sync 候选包空目录安装通过：`0.11.0` + registry protocol `0.6.1`，CLI、Publisher bootstrap、one-time-code onboarding、16 scopes 和篡改拒绝均通过。
- 独立多 Space 复审覆盖并发 A/B 凭据选择、A 撤销不影响 B、错误 selector、旧连接解析失败、健康 Space 与本地工具保留、安装失败回滚和并发保存；未发现 Critical / Important / Minor 问题。
- 真实 packed `0.11.0` stdio 网关验收通过：同 Agent 双 Space、独立凭据、并发页面读取、错误 selector、撤销 A 后 B 继续；`0.10.2` legacy 配置和 `0.9.1` 旧安装协议共存验收也通过。汇总收据为 `/tmp/agentwiki-q2-multi-space-acceptance-summary.json`，候选包 SHA-256 为 `f5e516a46d4178d4b16df0bce5915f7334651da195914517385d8ed52757801e`。

完整回归汇总为 **5952 通过 / 0 失败 / 6 既有或平台 skip**。证据来自本地隔离 PostgreSQL 和启用 AOF 的隔离 Redis；生产数据未作为测试数据。

## 已完成的外部发布与线上验收

- GitHub Release：[`v0.12.12`](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.12)，生产代码对应合并提交 `e2f68985d730647bd8c1444a1b1f3517715ba401`。
- npm：[`@neomei/agentwiki-local-sync@0.11.0`](https://www.npmjs.com/package/@neomei/agentwiki-local-sync/v/0.11.0)，公开 tarball SHA-1 为 `b13159e8aea9ed10a6dc032fbf6ffac0d6959988`，空目录安装、CLI 帮助和版本检查通过。
- 生产服务器：应用 `0.12.12`、Local Sync `0.11.0`，三项用户级 systemd 服务 active；默认 TLS `/api/health` 的数据库、Redis、审计持久化和附件存储均为 `ok`，onboarding 指令返回 `0.11.0`。
- 公网多 Space 验收：一个公开 npm 安装出的 stdio gateway 同时访问同一 Agent 的两个 Space；并发读页、两个 Space 各自提案/审批/发布/MCP 回读、错误 selector 拒绝和撤销 A 后 B 仍可读全部通过。清理收据显示 gateway、临时安装目录、临时 HOME、Agent、Space、凭据和 JWT 均已清理，详见 [`public-multispace-evidence.json`](verification/multi-space-v01212/public-multispace-evidence.json)。

## 覆盖边界

本次线上验收覆盖真实公网 API、MCP 和 stdio gateway 路径；没有把未运行的 Windows 原生 Obsidian GUI 或其他未覆盖客户端声明为通过。服务端没有新增 Prisma schema、迁移或同步协议变更，生产部署时迁移字节保持不变且未执行迁移。
