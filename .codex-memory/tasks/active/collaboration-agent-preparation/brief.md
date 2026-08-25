# 协作映射内准备 Agent

## 目标

修复协作运行“映射 Agent”在没有已授权可执行 Agent 时无法继续的问题，使 Owner/Admin 能在同一向导内选择或创建 Agent、恢复状态、授予当前 Space 执行角色、生成 MCP 接入指令、确认接入并完成当前 Role Slot 映射。

## 当前阶段

- Tasks 1–6 与最终补救已完成；核心状态收敛修复为 `7418b4e`，焦点可访问性修复为 `ab49860`，随后三项测试合同为 `9abcdcc`、`a6e0bbe`、`2392223`。
- 全仓最终门禁为 2,358 passed / 54 skipped / 0 failed；lint、typecheck、build、diff-check 均通过。隔离 PostgreSQL migration 2/2、workflow 10/10、并发幂等与审计回滚 1/1。
- 桌面与 390×844 真实 Browser 已覆盖空状态准备、创建/授权、Connect later、外部 connected 收敛、直接 pending、真实 403 跨轮询指引、fallback 焦点与无溢出；console error/warn 0。独立复审为 0C/0I/0M。
- Browser 页、API/Vite、Redis 临时键、随机 PostgreSQL schema 与临时 health 文件均已清理，复核为零残留。
- 本地实现已达到发布候选标准；push、npm 发布和生产部署未授权，任务继续保持 active。

## 完成标准

- 设计、计划、TDD 实现、回归和真实全链路验收完成。
- 权限不足、部分成功、接入过期和并发陈旧响应有明确行为。
- 未经单独授权不推送、不发布 npm、不部署生产。

## 本地验收结论

- 上述本地完成标准已满足，未发现仍值得修复的任务、代码或 UI 缺陷。
- 外部发布尚未授权，因此不归档本任务。
