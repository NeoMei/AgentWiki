<!-- codex-memory:template=task-brief:v1 -->

# space-add-agent-member

## 目标

在 Space 现有“添加成员”弹窗中增加“智能体”状态，让 owner/admin 添加自己拥有的 active Agent，并复用 AgentGrant、角色预设和现有细粒度权限管理。

## 当前状态

- 服务端校验、候选过滤、统一用户/智能体弹窗、SpaceMembers 集成和权限卡片安全修复均已实现；2026-07-31 已 fast-forward 合并到 `master` (`a15a7f3`)，不再只存在于隔离 worktree。
- 新增 Grant 只能使用调用者自有 active Agent；其他用户 Agent 与不存在 Agent 对外均表现为 404；已有 Grant 仍可由 Space owner/admin 管理。
- 最新 Node 24.18.0 门禁通过：服务端 33 suites / 244 tests，客户端 29 files / 120 tests、local-sync 49 tests、类型检查、ESLint、生产构建及真实 API owner/admin/editor 权限矩阵均通过。
- Owner 语义已收口为单一所有者：邀请入口不再允许直接新增 Owner，所有权转移会原子提升目标并把操作人降为 Admin。
- 真实 API 临时 Space 和 Agent 已清理；测试注册的临时人类账号没有公开删除端点，保留在本地开发库。
- Chrome 插件的 browser-client 初始化因运行环境拒绝 `node:process` 而失败，真实浏览器视觉与响应式验收尚未完成。
- 主工作区定向回归已重跑：客户端 29 files / 120 tests，服务端相关 2 suites / 18 tests；运行中 Vite 已能加载 `AddSpaceMemberDialog` 模块，前后端健康检查均返回 200。

## 下一步

- Chrome 插件恢复后补跑 owner/admin 添加流程、提交错误、中文/英文和 390x844 响应式验收。
- 浏览器验收通过后归档本任务，再恢复 `local-knowledge-sync` 第一阶段。
