<!-- codex-memory:template=task-brief:v1 -->

# 协作模板发布最终收口（2026-08-24）

## 目标

- 对 Agent 协作模板与组件执行多轮任务、代码、全栈测试和真实 UI 审查，修复所有值得修复的缺陷。
- 完成 Sync Protocol `0.3.0`、Local Sync 修订版 `0.6.1`、GitHub 与生产部署发布链，并核对四个发布面。

## 当前状态

- 任务已完成并归档。本地 `master`、GitHub `origin/master`、npm 和生产四个发布面均完成核验。
- npm Sync Protocol `0.3.0` 与 Local Sync `0.6.1` 已发布；公开元数据、空目录安装、依赖树与 CLI 启动均通过。损坏的 `0.6.0` 已标记弃用并提示升级。
- 三轮任务/代码/安全复核完成；两个代码缺陷均经 RED→GREEN 修复，第三轮代码复核无新的值得修复项。真实 npm 发布验收随后发现第三个发布缺陷：`0.6.0` 残留 `workspace:` 依赖无法公开安装；失败契约测试、`0.6.1` 修复和 registry 验收已闭环。
- 最新门禁：Server 1005、Client 316、Protocol 42、Local Sync 748 全通过；随机 schema 迁移/transaction 2+10 通过，HTTP/MCP E2E PASS，空目录双包安装 PASS。
- 真实桌面与 390px UI 验收通过，控制台无 warning/error，所有临时 schema/服务已清理。
- 生产升级为 AgentWiki/Local Sync `0.6.1`、Sync Protocol `0.3.0`，42 条迁移 up to date；公网 API/MCP 31/31 与 UI 5/15/6 各完成最终干净轮，服务零重启、日志无 error、活跃测试 fixture/schema 为 0。

## 完成条件

- 多轮任务完成度与代码审查无剩余值得修复项。
- 自动化全栈、隔离 PostgreSQL、HTTP/MCP E2E 与真实桌面/移动 UI 验收全部通过。
- 生产双备份可验证，迁移、服务、公网业务 smoke、日志与测试数据清理全部通过。
- 本地、GitHub、npm 与生产四个表面分别有当前证据并完全对齐。
