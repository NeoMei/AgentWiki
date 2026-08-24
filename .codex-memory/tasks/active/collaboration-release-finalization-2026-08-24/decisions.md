# 决策

- 2026-08-24：用户要求继续完成多轮任务、代码与系统测试审查，发现缺陷即修复并重复复核。
- 2026-08-24：沿用既定发布顺序：Sync Protocol `0.3.0` → registry 依赖门禁 → Local Sync `0.6.0` → 生产预检/双备份/部署/公网验收。
- 2026-08-24：当前运行评审改为按审核节点分别查询当前 generation 的最新 revision，避免全局 `take` 造成评审节点饿饿。
- 2026-08-24：WebSocket 在转发运行变更提示前刷新用户身份与运行访问权，已失权 socket 先退出房间；提示仍只含 `spaceId/runId/eventSequence`。
- 保留用户已有 sibling submodule 修改与 `agentwiki/.codebase-memory/`，不纳入本轮提交。
