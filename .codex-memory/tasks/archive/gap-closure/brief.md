<!-- codex-memory:template=task-brief:v1 -->

# 任务简报

## 目标

- 补齐 2026-07-15 深度需求审计确认的全部安全、状态机、摄取编译、来源追踪、界面和测试缺口，直到全量验收通过。

## 范围 / 不做

- 做：搜索数据最小化、JWT 撤销检查、Memory 空间隔离、审批并发、Worker 租约与凭证重验、增量编译和真实索引、来源证据、MCP 审计、空间导航、自动化测试与迁移验证。
- 不做：恢复公开 Agent 注册、服务器本地路径摄取、未经验证的四层记忆或时间衰减。

## 当前状态

- 已完成：全部代码差异、备份恢复验证、远端 13/13 迁移、源码直部署、systemd API/Worker/Frontend、业务 smoke、临时数据清理及文档/记忆同步。
- 已验证：16 个 Jest 套件 58 项、2 项 Vitest、双端类型检查、ESLint、Nest/Vite 构建；远端三服务 active/running、NRestarts=0，数据库与 Redis 健康，Docker 容器为 0。

## 已确认决定

- 详见 `decisions.md`

## 关键索引

- 详见 `refs.md`

## 风险 / 下一步

- 本任务完成，移入 archive。后续发布继续遵守备份 → 直部署 → 健康与业务 smoke 的顺序。
