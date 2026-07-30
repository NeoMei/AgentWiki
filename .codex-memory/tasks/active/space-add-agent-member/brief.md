<!-- codex-memory:template=task-brief:v1 -->

# space-add-agent-member

## 目标

在 Space 现有“添加成员”弹窗中增加“智能体”状态，让 owner/admin 添加自己拥有的 active Agent，并复用 AgentGrant、角色预设和现有细粒度权限管理。

## 当前状态

- 设计与实施计划已存在，用户要求在 local-knowledge-sync 大任务之前优先完成。
- Node 26.5.0 基线通过：服务端 32 suites / 232 tests，客户端 26 files / 104 tests。
- 计划已校正服务端边界：新增 Grant 只能使用调用者自有 active Agent；已有 Grant 仍可由 Space owner/admin 管理。

## 下一步

- 按 TDD 完成服务端校验、候选过滤、统一弹窗、SpaceMembers 集成、全量门禁和真实浏览器验证。
