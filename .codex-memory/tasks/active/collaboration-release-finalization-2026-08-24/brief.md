<!-- codex-memory:template=task-brief:v1 -->

# 协作模板发布最终收口（2026-08-24）

## 目标

- 对 Agent 协作模板与组件执行多轮任务、代码、全栈测试和真实 UI 审查，修复所有值得修复的缺陷。
- 完成 Sync Protocol `0.3.0`、Local Sync 修订版 `0.6.1`、GitHub 与生产部署发布链，并核对四个发布面。

## 当前状态

- 本地 `master` 与 GitHub `origin/master` 的已提交基线对齐到 `1b94700efbc27ffb8e8f3499e9a2585657cd3d5e`，`0.6.1` 修订候选待提交推送。
- npm Sync Protocol `0.3.0` 已发布；Local Sync `0.6.0` 经公开 registry 空目录安装确认因 `workspace:0.3.0` 无法安装，禁止部署。`0.6.1` 已改用精确依赖和真实 npm 打包门禁，待发布并弃用 `0.6.0`；生产仍公告 `0.5.1`。
- 三轮任务/代码/安全复核完成；两个已复现缺陷均经 RED→GREEN 修复，第三轮无新的值得修复项。
- 最新门禁：Server 1005、Client 316、Protocol 42、Local Sync 748 全通过；随机 schema 迁移/transaction 2+10 通过，HTTP/MCP E2E PASS，空目录双包安装 PASS。
- 真实桌面与 390px UI 验收通过，控制台无 warning/error，所有临时 schema/服务已清理。
- 下一阶段为提交/推送 `0.6.1` 修订，发布 npm、弃用 `0.6.0`，再完成生产双备份、部署与公网验收；发布完成前不得归档。

## 完成条件

- 多轮任务完成度与代码审查无剩余值得修复项。
- 自动化全栈、隔离 PostgreSQL、HTTP/MCP E2E 与真实桌面/移动 UI 验收全部通过。
- 生产双备份可验证，迁移、服务、公网业务 smoke、日志与测试数据清理全部通过。
- 本地、GitHub、npm 与生产四个表面分别有当前证据并完全对齐。
