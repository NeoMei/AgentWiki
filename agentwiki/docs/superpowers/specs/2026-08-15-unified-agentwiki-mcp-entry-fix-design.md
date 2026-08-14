# Agent 详情页统一 AgentWiki MCP 修复设计

> 日期：2026-08-15
> 状态：用户已确认方案，待实施
> 依赖设计：`2026-08-10-agent-self-service-onboarding-gateway-design.md`

## 1. 问题与根因

统一 gateway 已经能够在单个本地 stdio MCP 中提供 `wiki_*`、`local_*` 和 `knowledge_*` 工具，但 Agent 详情页仍保留两条旧接入路径：

- 创建普通 Agent Credential 后生成独立远程 MCP `agentwiki-<credentialId>`。
- “本地知识同步”生成已经从公开 CLI 删除的 `connect --server ... --code ...` 命令。

这两条遗留入口绕过统一 onboarding，导致本地同步安装器迁移旧 AgentWiki MCP 时覆盖独立远程连接；反向执行又会重新产生第二个 MCP。根因是产品入口没有随统一 gateway 设计完成迁移，不是服务端凭据模型冲突。

## 2. 目标与不做

### 目标

1. 一个客户端最终只有一个名为 `agentwiki` 的 MCP。
2. 已有 Agent 可以通过详情页的一次性安装码安装或更新统一 gateway。
3. 普通 Credential 继续支持 API、脚本和外部系统，但不再承担 MCP 安装职责。
4. 旧 direct/local AgentWiki MCP 只在用户确认的 gateway 安装过程中迁移。
5. 所有活动指令、测试和文档对单 gateway 规则保持一致。

### 不做

- 不改变 Credential Scope、Space Grant、Agent 状态、Space Policy 或审核规则。
- 不新增第二个 MCP 名称或恢复旧 `connect` 命令。
- 不把 API Key 写入 MCP 配置、命令输出或 Agent 对话。
- 不改变全局 Device Auth onboarding 创建新 Agent 的现有流程。

## 3. 产品行为

### 3.1 创建普通凭据

Agent 详情页继续允许创建、查看元数据和吊销普通 Credential。创建成功时只显示一次 API Key，并明确用途为 API、脚本或外部系统；不再生成 MCP 名称、远程 `/api/mcp` 注册命令或“复制接入指令”。

### 3.2 为已有 Agent 安装统一 gateway

“本地知识同步”仍绑定当前 Agent，并由服务端签发短时、一次性安装码。生成指令改为：

```bash
npx --yes @neomei/agentwiki-local-sync@<exact-version> onboard \
  --server <public-api-url> \
  --code <one-time-installation-code> \
  --protocol ndjson
```

`onboard --code` 是已有 Agent attach 模式：

1. 校验精确包版本与服务端 URL。
2. 交换一次性安装码并把 Agent Credential 保存到本机 `0600` 凭据文件。
3. 检查客户端配置并向用户展示将迁移的旧 AgentWiki MCP 项。
4. 用户确认后，原子备份配置，删除旧 direct/local AgentWiki MCP，写入唯一的 `agentwiki` gateway。
5. 独立启动 gateway 完成 MCP initialize、工具清单、远程身份和权限验证。
6. 返回结构化结果；该模式只安装连接，不自动扫描或同步本地内容。

全局无 `--code` onboarding 保持原有 Device Auth、计划确认、首次扫描和同步流程。

### 3.3 运行时

唯一 `agentwiki` gateway 使用本机保存的 Agent Credential 连接服务端 `/api/mcp`：

- 服务端工具映射为 `wiki_*`。
- 本地工具保持 `local_*`。
- 组合工具保持 `knowledge_*`。

普通 Credential 和 gateway Credential 都是服务端同一通用凭据模型的实例，但只有 gateway Credential 被本地 gateway 使用。服务端不感知 Codex、Claude Code、OpenCode 等客户端类型。

## 4. 配置迁移与失败处理

- 迁移只在用户确认后发生，并保留完整配置备份和并发 hash 检查。
- 识别旧项时优先依据已知旧名称、`@neomei/agentwiki-local-sync` 命令签名和当前 AgentWiki `/api/mcp` 端点；不得仅因第三方名称包含 `agentwiki` 就删除。
- 固定名称 `agentwiki` 若被未知第三方占用，返回 `CONFIG_CONFLICT`，不得覆盖。
- 安装或验证失败时恢复配置备份；已交换但未能完成安装的凭据按现有清理规则吊销。
- 安装成功后重复执行相同结果必须幂等；过期或已消费安装码必须返回明确终态错误。
- `uninstall` 只删除命令签名确认属于本包的 `agentwiki` gateway，不删除普通 API Credential，也不删除其他 MCP。

## 5. 代码范围

- 客户端：移除 Agent Credential 的 MCP 连接提示；更新 Agent 详情页和使用指南文案、测试。
- 服务端：本地同步安装指令从 `connect` 改为固定版本 `onboard --code`；保持现有一次性码、scope 和审计语义。
- local-sync：为 `onboard` 增加安装码 attach 分支，复用现有 exchange、原子安装、验证和清理组件；不恢复独立 `connect` 命令。
- 配置安装器：收紧旧项识别和卸载所有权判断，同时保留显式迁移旧 direct/local MCP 的能力。
- 文档与契约门禁：删除“两 MCP”描述，扫描所有活动页面、服务端指令、README 和 Skill，拒绝 direct MCP 注册指令及 `connect --server`。

## 6. 测试与验收

实施遵循测试先行，至少覆盖：

1. 创建 Credential 后只显示 API Key，不包含 `/mcp`、`mcp add` 或独立连接名。
2. 安装服务生成精确版本 `onboard --code`，不包含 `connect`。
3. `onboard --code` 不启动 Device Auth、不创建新 Agent，只绑定安装码指定的现有 Agent。
4. Codex、Claude Code、OpenCode 均把旧 direct/local 项迁移为一个 `agentwiki` gateway，并保留无关 MCP。
5. 未知同名占用、并发配置修改、安装码失效和 gateway 验证失败均安全终止或回滚。
6. 重复 attach 幂等；卸载只移除本包 gateway。
7. gateway 工具清单同时包含 `wiki_*`、`local_*`、`knowledge_*`，不存在第二个 MCP。
8. 全仓 runtime contract 拒绝活动入口中的 direct remote MCP、旧 `connect` 和“两 MCP”描述。
9. local-sync、server、client 全量测试、typecheck、lint 和生产构建通过。

## 7. 发布边界

该修复会改变已发布 npm 包的 CLI 行为，必须使用新的补丁版本，不能覆盖 `0.3.6`。代码实现与本地验证完成后，npm 发布、合并 `master` 和生产部署作为独立发布动作执行，并继续遵守备份、健康检查和三客户端验收门禁。
