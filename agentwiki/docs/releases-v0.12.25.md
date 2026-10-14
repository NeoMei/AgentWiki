# AgentWiki v0.12.25 / Local Sync v0.12.0

Agent 只需接入一次 AgentWiki；每次调用按目标 `spaceId` 检查实时空间授权。新增空间 Grant 可立即使用现有连接，撤销一个空间不会删除 Agent 凭据，也不会影响其他已授权空间。

## 变更

- AgentCredential 只承担 Agent 身份与凭据生命周期。Space Grant 分别决定 Reader、Editor、Publisher 角色，异步任务、审核写入和协作执行仍会重新检查目标空间授权。
- Local Sync 使用选定 Agent 的同一连接访问全部授权空间；`wiki_list_spaces` 动态发现空间，不从其他 Agent、客户端或服务器借用凭据。
- 页面、来源和协作资源的显式 `spaceId` 必须与真实归属一致。Agent 不能审批 ChangeSet 或管理成员；Publisher 仍受 Agent 模式和空间策略约束。
- 接入页面区分 Agent 身份凭据与空间授权；新增授权无需为每个空间重新安装。拥有有效凭据不再被误报为当前本机客户端已经握手成功。
- 旧 Tree v2 工作目录及未提交文件保留，Agent 知识工作区与旧人类设备同步目录隔离。
- MCP 新增 `propose_page_update`，按原页面 ID 更新标题、正文和目录，必须携带页面与目录树版本基线；通过既有 ReviewService 检查权限、审批策略与并发冲突。`propose_page` 支持指定目录。

应用 root/server/client 为 `0.12.25`，Local Sync 为 `0.12.0`，同步协议保持公开的 `0.6.1`。服务端继续接纳 `0.9.0`、`0.9.1`、`0.10.0`、`0.10.1`、`0.10.2` 和 `0.11.0` 的原始安装版本与计划哈希。现有网关需升级至 `0.12.0` 才能获得同一连接动态访问新增空间的行为；无需重新签发 Agent 密钥。

## 数据库与部署

本次包含迁移 `20261014120000_agent_identity_credentials`。迁移保留 Credential ID、密钥 hash、过期和撤销状态、安装身份；历史 `authorizationId` 保留为可空审计字段，解除到 Grant 的外键及删除级联。新增身份凭据不再依赖某个 Grant。

先完成并核验数据库、附件和应用配套备份，再协调数据库、服务端/前端与网关发布。新数据不能直接交给依赖旧必填外键的旧服务端；回滚需要恢复匹配的数据库与应用备份。发布配置为 `LOCAL_SYNC_PACKAGE_VERSION=0.12.0`。

## 验证

- 最终发布候选（含版本更新和 MCP 原位编辑）：完整隔离门禁 **7,114 通过、6 项既有跳过、0 失败**，类型检查、lint、构建通过。MCP 独立复审及真实网关工具透传检查通过。详见 [发布门禁](verification/agent-identity-space-auth-20261014/release-gates.json) 与 [独立复审](verification/agent-identity-space-auth-20261014/release-review.json)。
- 发布版本：Local Sync 打包前 **996 通过、1 项既有跳过**；版本契约 **69 通过**；前端接入/安装版本 **45 通过**；服务端新旧版本接纳 **171 通过**。
- Local Sync 候选 tarball 与公开协议 `0.6.1` 在空目录安装通过，CLI、Publisher device bootstrap、一次性 code、16 scopes 与篡改拒绝通过；协议本地构建与公开 npm 包字节一致。
- GitHub/npm/生产部署、真实本机 MCP 升级及目标空间回读分别记录；这些外部结果不能由本地测试替代。发布过程收据追加到 [验收目录](verification/agent-identity-space-auth-20261014/)。

项目站点 v2 文档仍是单独交付项；只有通过 MCP 写入并逐页回读后，才记录为已完成。
