# 决策

- 2026-08-24：用户要求继续完成多轮任务、代码与系统测试审查，发现缺陷即修复并重复复核。
- 2026-08-24：Sync Protocol `0.3.0` 已发布；Local Sync `0.6.0` 的实际 npm 包残留 workspace 依赖，公开安装失败，因此不部署，统一修订到 `0.6.1` 并弃用损坏版本。
- 2026-08-24：Local Sync 发布清单直接精确依赖 Sync Protocol `0.3.0`；工作区以 `linkWorkspacePackages: true` 保持本地联动。空目录安装门禁改用与实际发布一致的 `npm pack`，registry 模式不得预装协议包来掩盖依赖解析缺陷。
- 2026-08-24：当前运行评审改为按审核节点分别查询当前 generation 的最新 revision，避免全局 `take` 造成评审节点饿饿。
- 2026-08-24：WebSocket 在转发运行变更提示前刷新用户身份与运行访问权，已失权 socket 先退出房间；提示仍只含 `spaceId/runId/eventSequence`。
- 保留用户已有 sibling submodule 修改与 `agentwiki/.codebase-memory/`，不纳入本轮提交。
