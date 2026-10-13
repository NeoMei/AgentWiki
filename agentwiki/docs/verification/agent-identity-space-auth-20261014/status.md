# Agent 一次接入：v0.12.25 发布与验收

日期：2026-10-14。分支：`codex/agent-identity-space-auth`。基线：`6de18645402d02fcda51ebd193de81465f8a1934`（v0.12.24）。

## 结论

Web `0.12.25`、Local Sync `0.12.0` 已正式发布并完成生产验收，发布提交为 `48781e5b192101a2d122dd143048d983bca8a29b`。原本机连接升级后，使用公开 npm 网关通过 MCP 成功列出 3 个已授权 Space，并读取目标项目空间的 15 页、5 个目录及首页。Agent 凭据只标识身份，每次调用按目标 `spaceId` 查询当前 Grant。

软件发布与接入恢复已验证；17 篇模板文档正在按用户新授权推进 MCP 发布，尚未完成逐页正式回读。

## 行为与证据

| 行为 | 验证 |
| --- | --- |
| 同一身份动态发现并访问新授权 Space | MCP 网关集成测试：同一 key、无需配置修改/重载、并发 Space 请求隔离 |
| 不借其他 Space、Agent、服务器或客户端权限 | 网关拒绝路径和服务端实时授权回归 |
| 撤销 A 保留 B，降级按当前角色拒绝写 | PostgreSQL 实际 Grant 变更、旧 key 鉴权、服务端与网关回归 |
| 凭据/Agent/owner 生命周期失效拒绝所有 Space | 真实数据库及授权回归；异步 Source、Review、协作事务授权检查 |
| 旧凭据迁移保留 key hash、安装身份、撤销与过期 | 实际旧表形状执行迁移，Grant 删除不级联删凭据；新凭据可无历史 Grant |
| 对象 ID 与显式 spaceId 必须一致 | 页面/来源/协作 selector 测试与服务端审查 |
| UI 不把任意凭据当作客户端握手，不把 Reader 当执行角色 | 13 项补充测试；两项 P2 修复后独立复审通过 |
| 旧 Tree v2 目录和 dirty 文件保留 | 5 项升级回归覆盖先拉取/先准备、部分控制状态、目录搬移、缺失 base；P1 独立复审关闭 |

## 最终检查

`pnpm test:full` 退出 0；合计 **7,114 通过、6 跳过、0 失败**。

| 阶段 | 通过 | 跳过 |
| --- | ---: | ---: |
| Runtime 非数据库 | 309 | 1 |
| Runtime 数据库 | 232 | 0 |
| Server | 3,124 | 4 |
| Client | 2,313 | 0 |
| Sync protocol | 140 | 0 |
| Local Sync | 996 | 1 |

跳过为既有 CodeGraph opt-in、3 项 CONNECTION_UX_DB_TEST 专用接入套件、Windows OpenCode 与 Windows ACL；不把这些列为通过。新增身份迁移数据库测试在隔离 schema 中执行。数据库测试通过自动建立的 loopback 专用测试库、随机 schema 与临时 Redis 执行，未使用业务库。

`pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check` 通过。前端首屏 JavaScript 为 548,206 / 550,000 字节；构建保留既有大型异步图表 chunk 提示。

最终发布门禁日志：`/tmp/agentwiki-v01225-full-test.log`、`/tmp/agentwiki-v01225-typecheck.log`、`/tmp/agentwiki-v01225-lint.log`、`/tmp/agentwiki-v01225-build.log`。该门禁覆盖 MCP 原页面更新、目录定位和最终版本更新；详见 [release-gates.json](release-gates.json) 与 [release-review.json](release-review.json)。

## 外部发布与真实接入

| 项目 | 已核验事实 | 收据 |
| --- | --- | --- |
| GitHub | `v0.12.25` 正式 Release，tag 对应发布提交 | [github-release-receipt.json](github-release-receipt.json) |
| npm | `latest=0.12.0`；官方 registry 空目录/空 cache 安装、CLI 通过；167 个包文件一致 | [npm-registry-receipt.json](npm-registry-receipt.json) |
| 生产源码与资源 | 1,252 个文件匹配提交；网页入口、JS/CSS 与部署字节一致 | [production-receipt-0.12.25.json](production-receipt-0.12.25.json) |
| 迁移与保留 | 历史列可空、Grant 外键和索引移除、Agent 外键保留；旧 71 个凭据与 482 个 Grant 稳定字段无丢失/变化；正常新增分别 1 条 | 同上 |
| 环境与服务 | 仅 Local Sync 版本变量允许改变；API/worker/frontend 均 running、零自动重启，内公网 health 全 ok | 同上 |
| 本机升级 | 网关升级 0.12.0；原 connection、Agent、凭据及其他配置保持，备份已留存 | [local-gateway-upgrade-receipt.json](local-gateway-upgrade-receipt.json) |
| MCP 实读 | 同一原连接通过公开 0.12.0 stdio 网关列出 3 个授权空间，目标项目 publisher，15 页/5 目录/首页成功读取 | [mcp-live-readback-receipt.json](mcp-live-readback-receipt.json) |

生产数据库比较在正常服务运行时完成，忽略活动时间 `lastUsedAt` / `updatedAt`，新增记录单独计数；不能描述为停写期间全字段完全不变。真实 MCP 验证不等于声明当前 Codex 工具进程完成了热重载。仅保存计数、ID、状态和 hash，不保存页面正文、邮箱或认证内容。

## 发布与原任务边界

- 配套数据库、附件、应用备份已验证；位置及大小记录在 [publication-progress.json](publication-progress.json)。新凭据允许不绑定 Grant；如回滚，仍需匹配的数据库与应用恢复，不能单独回到旧服务端。
- 原目标 Space `cmv6biedu005okoisb9fgp64y` 已通过同一原连接 MCP 实读，逐 Space 连接阻塞已解除，不需要重新领取接入码。
- MCP 目录改名提案已创建，当前保存的回执为 `pending_review`、`autoPublished=false`；创建提案不等于目录正式发布。
- 用户已明确允许 Publisher 自动发布，主代理正在应用审核政策并通过 MCP 更新模板。17 篇模板仍须按原页面 ID 写入、创建缺失页并逐页正式回读；本报告不把软件发布或写提案当作文档交付完成。
