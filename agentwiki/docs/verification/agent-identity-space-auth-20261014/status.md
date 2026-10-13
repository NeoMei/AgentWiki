# Agent 一次接入：本地候选验收

日期：2026-10-14。分支：`codex/agent-identity-space-auth`。基线：`6de18645402d02fcda51ebd193de81465f8a1934`（v0.12.24）。

## 结论

本地实现与独立复审通过。Agent 凭据只标识身份；每次调用按目标 `spaceId` 查询当前 Grant。尚未发布服务端或 npm，未升级真实本机 MCP，未验证目标生产空间；不能据本报告声称线上已恢复。

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

`pnpm test:full` 退出 0；合计 **7,084 通过、6 跳过、0 失败**。

| 阶段 | 通过 | 跳过 |
| --- | ---: | ---: |
| Runtime 非数据库 | 309 | 1 |
| Runtime 数据库 | 232 | 0 |
| Server | 3,094 | 4 |
| Client | 2,313 | 0 |
| Sync protocol | 140 | 0 |
| Local Sync | 996 | 1 |

跳过为既有 CodeGraph opt-in、3 项 CONNECTION_UX_DB_TEST 专用接入套件、Windows OpenCode 与 Windows ACL；不把这些列为通过。新增身份迁移数据库测试在隔离 schema 中执行。数据库测试通过自动建立的 loopback 专用测试库、随机 schema 与临时 Redis 执行，未使用业务库。

`pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check` 通过。前端首屏 JavaScript 为 548,206 / 550,000 字节；构建保留既有大型异步图表 chunk 提示。

本机原始日志：`/tmp/agent-identity-full-test-3.log`、`/tmp/agent-identity-final-types.log`、`/tmp/agent-identity-final-lint.log`、`/tmp/agent-identity-final-build.log`。Local Sync 最后两个文件更新时间 00:18:35 / 00:18:54，完整包测试于 00:19:05 开始，覆盖最终冻结代码。

## 发布与原任务边界

- 需要协调发布数据库迁移、服务端/前端及 Local Sync 网关；发布时还需确定新版本号、更新安装命令版本、验证正式打包安装及注册表。
- 迁移保留历史 authorizationId 为审计字段；新凭据可为空。不可只回退到依赖旧必填 FK 的旧服务端；发布前须数据库/附件/应用配套备份并明确恢复策略。
- 当前正式 MCP 仍为旧 0.11.0，目标 Space `cmv6biedu005okoisb9fgp64y` 的 `SPACE_CONNECTION_REQUIRED` 尚未经真实回读解除。不要求用户提供逐 Space 连接码。
- 项目站点 v2 的 17 篇草稿已保留，接入规范已按新设计修正。恢复访问后，仍须核查现有页面更新的 MCP 能力、按原页面 ID 写入并回读；本轮没有改动远程页面。
