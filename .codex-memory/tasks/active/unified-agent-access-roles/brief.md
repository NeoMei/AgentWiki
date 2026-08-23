# Agent 统一访问角色

## 目标

将 Agent 的 Space Grant、连接码授权和 Credential 授权合并为一次角色选择，统一使用 `reader`、`editor`、`publisher`，修复 Agent 显示 editor 但 OpenCode Credential 缺少 `pages:write` 的问题。

## 当前阶段

- 本地生产代码、单一授权源数据库迁移、前端、sync-protocol、local-sync、onboarding、MCP 回归和文档已完成。
- 旧 Agent `approvalMode` 请求旁路、0.4.0 部署默认、仍发送旧字段/scopes 的 onboarding/cross-machine/smoke E2E fixture 和未使用的 `agent.viewer` 文案键已在最终扫描中修复。
- 已修复 local-sync 0.5.0 干净安装时依赖 npm 旧 sync-protocol 0.1.0 导致 CLI 无法启动的发布阻断；sync-protocol 升为 0.2.0，两个候选包联合干净安装通过。
- 提交态全仓构建、测试、类型、lint、Prisma、三客户端 onboarding、打包和静态扫描均通过。
- 最终广度审查的三项 Important 已修复：Reader 只读 bootstrap/pull 收尾、Space admin + Agent owner 双门槛、auto-publish 发布事务中锁定并重验当前授权状态。
- 原最终 reviewer 复审后又完成多轮独立缺陷检查，新增修复包括：Publisher 手工写入原子性、删除 Space 后禁止兑换回放、Reader 缺少 pull 时失败关闭、token 在 post-install checkpoint 落盘后再清理、bootstrap 名称绑定、前端选择变化时废弃旧接入码，以及手工 Grant/Credential 在事务内重验撤权状态。
- 最新完整 build/test/typecheck/lint/Prisma、三客户端 onboarding、双包打包与空目录安装门禁均通过；收敛轮未再发现值得修复的问题。任务保持 active 仅因为外部发布和真实 OpenCode 验收尚未获授权。
- 2026-08-23 UI 复核发现原实现仍把 Agent Grant、统一连接和手工 Credential 做成三套可编辑入口。现已删除 Agent 详情页的独立 Grant/Credential 编辑器和手工 Credential API；唯一授权入口一次选择 `Space + role`，连接兑换原子生成匹配的 Grant 与 Credential。已有记录仅查看/撤销。
- 修正后真实浏览器桌面和 390px 移动端均只有一个角色选择器、没有 `授权`/`创建凭据` 按钮、没有横向溢出；已有 Editor 授权默认选中 Editor。最终全量测试为 runtime 87 / server 751 / client 223 / sync-protocol 25 / local-sync 736，其他构建门禁和双包干净安装通过。
- 2026-08-23 用户复核指出核心仍是双权限源。现已删除 Credential role/scopes 与 Grant scopes，增加同 Agent 复合外键绑定；鉴权、自动发布、Worker、MCP 发现和 Local Sync 诊断均只使用绑定 Grant。真实全新数据库 + MCP 验收完成；追加复核还修复了连接角色默认误降级、跨 Space MCP 最近调用泄漏和高负载锁测试假失败。
- 2026-08-23 最终漏洞审查又修复了 Agent 提案/Knowledge/Memory 撤权竞态、Grant 交换与 Agent/用户撤销的锁顺序死锁、超管授权 Space 前端过滤、>100 Space 分页/reset，以及破坏性迁移的真实部署顺序和失败保全。PostgreSQL 16 真实并发测试 3/3 通过；最终独立复审为 `FINAL CLEAN / 0 findings`。
- 依赖审计追加发现 NestJS `GHSA-36xv-jgw5-4q75`，已升级 Nest 系列 11.2.1 / Express 5.2.1 并修复 webpack peer override；升级后 lint/type/build/全量测试通过，audit 与 peer 问题均为 0。

## 范围

- 统一角色策略、唯一 Grant 角色及身份型 Credential 绑定；
- Space + role 的一次性连接授权包；
- 原子兑换、幂等和审计；
- Agent 访问页的单一连接授权、本地同步与三客户端协议；
- MCP 权限回归和真实 OpenCode 验收。

## 不做

- 旧 `viewer` / `full` / 自定义 scopes 兼容；
- Agent 人工审批、成员管理或 `review:decide`；
- 自动修改 Space Policy。

## 下一步

1. 等待用户单独授权 push、npm sync-protocol 0.2.0 / local-sync 0.5.0 发布和生产部署；本轮修复尚在本地特性分支。
2. 部署前创建并验证数据库 custom dump 和应用回滚包，记录指纹。
3. 发布后用新 Editor 连接完成真实 OpenCode 提案、Agent 不可审批和人工审批后内容确认。
