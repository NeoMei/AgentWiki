# AgentWiki v0.12.13 发布记录

## 范围

这是一次兼容的应用补丁版。它保留 AgentWiki v0.12.12 的多 Space Local Sync 契约，并收紧文档与 Agent 工作流中容易产生陈旧状态的边界：同步回执不会回放旧来源元数据；异常 Run/Source 关联不会跨 Space 展开；来源失权后 Review 内容和缓存会清除；全量测试门禁保留完整失败输出；同步状态只接受来源、版本和 Space 一致的 Run；Human Space Admin 能看到实际拥有的模板创建能力；新建页预览只聚焦首个有效结果，过期请求不会污染当前预览。

本次不引入 CodeWiki、不改变 ACP 接口范围、不新增 Prisma 迁移，也不改变 Local Sync 或同步协议版本。应用版本为 `0.12.13`，Local Sync 继续为 `0.11.0`，同步协议继续为 `0.6.1`。

## 验证

- 最终 client 回归：2170 通过。
- 最终 server 回归：2994 通过，另有 3 项连接授权门禁补跑通过；4 项既有环境 skip 保留并如实记录。
- Runtime：305 通过，1 项 opt-in skip；数据库回归 230 通过；协议 140 通过；Local Sync 985 通过，1 项 Windows skip。
- typecheck、build、lint 全部成功；lint 保留 3 条既有 warning。
- Chrome 最终验收 31/31 通过；新建页模板 R11 为 10/10；来源审批、显式引用、跨文档连续会话、双候选与人工改稿交错、接受/撤销/冲突、长文宽表和移动宽度均按验收清单验证。
- 运行时、测试数据库、端口、Agent IPC 和临时目录均已清理。CodeGraph opt-in、Windows bundled OpenCode 和 Windows ACL 仍属于未执行的平台边界。

完整证据见 [`comprehensive-audit-20261007/acceptance.md`](verification/comprehensive-audit-20261007/acceptance.md) 和同目录索引。
