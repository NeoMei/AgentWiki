<!-- codex-memory:template=task-brief:v1 -->

# 任务简报

## 目标

- 按 `design/REMEDIATION_TODO.md` 的顺序完成全部整改，并通过测试、构建和安全回归验收。

## 范围 / 不做

- 做：P0 工程安全基线、设计重基线、Agent 管理、摄取与来源、审批编译、记忆、MCP、完整界面入口和验证。
- 不做：不改造或提交参考仓库；不以虚假占位页面冒充能力完成；不在未验证前标记清单完成。

## 当前状态

- 已完成：P0-P6、三/四/五条二次差异清单、REST/MCP 审批旁路封堵、独立 Worker、旧双轨删除、设计与运维文档、全量门禁和渲染 QA。
- 验收证据：见 `design/REMEDIATION_GAP_345.md` 与 `design/REMEDIATION_TODO.md`。
- 剩余工作：无；本任务可视为完成记录，后续新需求应建立新任务。

## 已确认决定

- 详见 `decisions.md`

## 关键索引

- 详见 `refs.md`

## 风险 / 下一步

- 生产环境必须配置 JWT、CORS、MCP/Git Host 白名单、Redis 和备份策略。
- 后续增加持续端到端回归与记忆召回质量样本，不重新开放已关闭的安全旁路。
