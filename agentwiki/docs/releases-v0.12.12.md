# AgentWiki v0.12.12 / Local Sync v0.11.0 发布候选

## 范围

本候选让同一个 Agent 的一个 `agentwiki` Local Sync 网关保存多个 Space 连接。每个连接继续绑定自己的 `spaceId`、Credential 和 Grant；调用按显式 `spaceId` 选取凭据，未知或冲突的 Space 选择会失败并拒绝回落到其他 Space。旧的单连接配置可以迁移读取，新增 Space 采用合并写入并保留其他连接。

应用版本为 `0.12.12`，`@neomei/agentwiki-local-sync` 为 `0.11.0`，`@neomei/agentwiki-sync-protocol` 继续使用已发布的 `0.6.1`。服务端继续接受 `0.9.0`、`0.9.1`、`0.10.0`、`0.10.1`、`0.10.2` 和 `0.11.0`。本次没有 Prisma schema、迁移或同步协议改动。

## 当前验证收据

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

## 发布前剩余门槛

`@neomei/agentwiki-local-sync@0.11.0` 当前在公开 npm Registry 中不存在（查询返回 404），所以生成的接入指令在实际发布前不能交付给真实 Agent。协议 `0.6.1` 已公开且 parity 已核对。npm 会话现已恢复为 `neomei`，可以执行包发布。

生产部署也尚未执行：SSH 已恢复并确认线上 0.12.11 与三项 systemd 服务正常，但还没有停止服务、迁移数据库或修改生产文件。生产真实多 Space Agent/MCP 接入验收需在 npm 发布后执行。

完成候选审查后，最后的外部动作顺序应为：

1. 使用已认证的 npm 会话发布 Local Sync `0.11.0`，并以公开 Registry 空目录安装复核。
2. 推送 GitHub 分支并创建/合并发布 PR，打 `v0.12.12` 标签及 GitHub Release。
3. 按现有备份、迁移完整性和 systemd 流程部署应用与网页指令，将生产 `LOCAL_SYNC_PACKAGE_VERSION` 更新为 `0.11.0`。
4. 用两个真实 Space 验收同一个 Agent 的 `list_spaces`、显式 `spaceId` 路由、撤销隔离和本地工具，再记录清理收据。

用户已要求推进到发布状态；以上动作在验证门禁通过且认证可用后执行，不能把候选测试结果作为外部发布或线上验收收据。
