# 一次 Agent 接入修正计划

关联设计：[一次接入与实时授权](../specs/2026-10-13-agent-identity-space-authorization.md)。

## 实现分工

| 任务 | 范围 | 交付与检查 |
| --- | --- | --- |
| 服务端身份与权限 | Auth、Authorization、Grant/Credential、Review、Source、协作、Prisma migration | 先失败行为回归，再实现；迁移及撤权/降级/异步复验 |
| 网关与安装兼容 | local-sync 路由、Access 类型、knowledge、status/doctor、打包 Skill | 单身份动态发现；新增 Grant 无需重载；空间数据隔离 |
| 接入与授权界面 | Agent 详情、凭据、安装卡、协作准备、双语说明 | 一次接入文案；凭据和 Grant 分离；已有身份连接新增授权可用 |
| 集成与独立审阅 | API 契约、完整类型/构建/测试、DB回归及本地 MCP | 修复跨模块问题；区分代码、候选、发布、本机升级与实际回读 |

共享工作树使用绝对路径；Git 必须显式 `--work-tree`，不得更改共享 `core.worktree`。各实现代理只修改分配范围。不得在实现中操作生产授权、凭据或用户资料。

## 状态

2026-10-14：服务端、网关与前端实现及独立复审通过。两项 UI P2 和旧 Tree workspace 兼容 P1 均已修复并复审关闭；完整测试 7,084 通过、6 跳过、0 失败，类型、lint、构建通过。尚未发布或升级本机正式 MCP。

验收与发布边界：[本地候选验收](../../verification/agent-identity-space-auth-20261014/status.md)。
