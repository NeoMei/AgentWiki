# 决策

- 2026-08-24：用户要求继续完成多轮任务、代码与系统测试审查，发现缺陷即修复并重复复核。
- 2026-08-24：Sync Protocol `0.3.0` 已发布；Local Sync `0.6.0` 的实际 npm 包残留 workspace 依赖，公开安装失败，因此不部署，统一修订到 `0.6.1` 并弃用损坏版本。
- 2026-08-24：Local Sync 发布清单直接精确依赖 Sync Protocol `0.3.0`；工作区以 `linkWorkspacePackages: true` 保持本地联动。空目录安装门禁改用与实际发布一致的 `npm pack`，registry 模式不得预装协议包来掩盖依赖解析缺陷。
- 2026-08-24：当前运行评审改为按审核节点分别查询当前 generation 的最新 revision，避免全局 `take` 造成评审节点饥饿。
- 2026-08-24：WebSocket 在转发运行变更提示前刷新用户身份与运行访问权，已失权 socket 先退出房间；提示仍只含 `spaceId/runId/eventSequence`。
- 2026-08-24：npm 已发布 Local Sync `0.6.1` 并通过公开 registry 空目录安装；损坏的 `0.6.0` 已标记弃用，生产只允许部署 `0.6.1` 发布线。
- 2026-08-24：生产 UI smoke 的旧 `/settings/integrations` 期望与已确认的 Obsidian 单入口设计冲突；保留产品重定向行为，把烟测契约修订为 `/guide/obsidian`，RED→GREEN 后再跑全量门禁和公网干净轮。
- 2026-08-24：历史 smoke 行采用产品软删除语义保留审计；只清理唯一仍活跃、所有权完全匹配且无非测试成员的 2026-08-21 UI fixture，不物理删除历史记录。
- 2026-08-24：生产在双备份验证后部署 `0.6.1/0.3.0`，公网验收与清理全部通过，任务归档。
- 保留用户已有 sibling submodule 修改与 `agentwiki/.codebase-memory/`，不纳入本轮提交。
