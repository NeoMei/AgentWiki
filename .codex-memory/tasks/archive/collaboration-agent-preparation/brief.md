# 协作映射内准备 Agent

## 目标

修复协作运行“映射 Agent”在没有已授权可执行 Agent 时无法继续的问题，使 Owner/Admin 能在同一向导内选择或创建 Agent、恢复状态、授予当前 Space 执行角色、生成 MCP 接入指令、确认接入并完成当前 Role Slot 映射。

## 完成阶段

- Tasks 1–6 与最终补救已完成；核心状态收敛修复为 `7418b4e`，焦点可访问性修复为 `ab49860`，随后三项测试合同为 `9abcdcc`、`a6e0bbe`、`2392223`。
- 全仓最终门禁为 2,358 passed / 54 skipped / 0 failed；lint、typecheck、build、diff-check 均通过。隔离 PostgreSQL migration 2/2、workflow 10/10、并发幂等与审计回滚 1/1。
- 桌面与 390×844 真实 Browser 已覆盖空状态准备、创建/授权、Connect later、外部 connected 收敛、直接 pending、真实 403 跨轮询指引、fallback 焦点与无溢出；console error/warn 0。独立复审为 0C/0I/0M。
- Browser 页、API/Vite、Redis 临时键、随机 PostgreSQL schema 与临时 health 文件均已清理，复核为零残留。
- 2026-08-25 新一轮发布审查再次得到同一结论：安全 diff 36/36 且 0 finding，隔离 DB 2/2 + 10/10 + 1/1，真实 Browser 从空映射启动到 Run 看板并通过 390px/console/清理检查。末轮修复 2 个测试 fixture 问题（缺失安装响应 mock、固定时刻凭证过期），无需产品代码修订；52/52、前端聚焦 145/145、服务端聚焦 117/117 后完整门禁再次为 2,358/54/0。
- 当前 HEAD `82b6a61d` 再次完成相同范围的发布级复核：计划 36/36、全量门禁 2,358/54/0、隔离 DB 12/12 + 1/1、封存安全审查 36/36 与 9 个风险面且 0 candidate/0 deferred/0 finding。真实 Browser 从空映射完成站内创建、Publisher 授权、Connect later、六角色映射、职责分离门禁、启动和 Run 看板；桌面/390px、焦点、console 与零残留清理均通过。测试环境启动门禁和脚本旧 token 字段经系统化定位后只修正运行配置，无产品或测试源码改动。
- 2026-08-25 获得独立发布授权后，本地 `master` 和 GitHub `master` 对齐到应用提交 `d843fba620c5cfaf8a1b68d96aa21596f56dad5c`。
- 生产发布前数据库与应用双备份已创建并验证；staging 构建、42 条迁移状态、三项服务、公网健康和 727 个部署文件 SHA-256 均通过。
- 已登录生产 Browser 验收确认空 Agent 映射的站内恢复入口、已有/新建 Agent 弹窗、Reader 到 Editor/Publisher 路径、焦点恢复和 390×844 无横向溢出；console error/warn 为 0，未提交生产数据变更。
- npm 包无变化，继续使用 Local Sync `0.6.1` 与 Sync Protocol `0.3.0`；任务已完成并归档。

## 完成标准

- 设计、计划、TDD 实现、回归和真实全链路验收完成。
- 权限不足、部分成功、接入过期和并发陈旧响应有明确行为。
- 外部发布必须获得单独授权；本次已获得授权并完成 GitHub 与生产发布。

## 最终结论

- 上述本地完成标准已满足，未发现仍值得修复的任务、代码或 UI 缺陷。
- GitHub、生产应用、数据库迁移、服务健康和真实 Browser 用户路径均已验证；回滚材料与上一版应用树已保留。
