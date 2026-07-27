<!-- codex-memory:template=project-agents:v1 -->
# Project Instructions

## Workspace Assistant Rules
- 默认使用中文沟通，优先给出结论，再给步骤。
- 面对需求分析、数据调研、文档撰写、Notion 沉淀、表格处理、轻量开发等任务时，优先采用最直接、可落地的方式完成。
- 当遇到重复处理、重复整理、重复分析或明显可复用的任务模式时，主动将其抽象沉淀为最适合 Codex 理解和复用的 skill；必要时补充 SKILL.md、脚本、参考资料或模板，并在后续类似任务中优先复用。

<!-- CODEX-MEMORY:START -->
## 项目级上下文管理

- 本项目使用 `.codex-memory/` 作为项目级结构化记忆目录，不再继续把 `codex-handoff.md` 作为主交接文件持续追加。
- 新会话开始时，优先按下面顺序读取：
  1. `.codex-memory/current.md`
  2. `.codex-memory/spec/index.md`
  3. 若存在活跃任务，再读 `.codex-memory/tasks/index.md` 与对应 `tasks/active/<task>/brief.md`
- 默认不要主动加载 `.codex-memory/archive/`；只有在用户明确要求追溯历史，或当前信息不足以判断时，才按需查阅归档。
- 若项目存在已冻结的旧 handoff 文件，默认不要再读取它作为主入口；仅在追溯迁移来源时按需查看。

## current 规则

- `.codex-memory/current.md` 只保留“当前有效信息”，必须覆盖更新，不得持续追加历史流水账。
- `current.md` 默认只保留以下固定栏目：
  - `当前目标`
  - `范围 / 不做`
  - `当前状态`
  - `稳定约束`
  - `关键索引`
  - `风险 / 下一步`

## spec 规则

- 长期稳定规则写入 `.codex-memory/spec/`，不要在 `current.md` 和 `archive/` 中重复堆积同类规则。
- 同一条规则若跨两次以上会话仍有效，或在两个以上主题中重复出现，应提升到 `spec/`。

## tasks 规则

- 大型任务使用 `.codex-memory/tasks/active/<task>/` 单独维护。
- 创建活跃任务目录时，必须同时创建：
  - `brief.md`
  - `decisions.md`
  - `refs.md`
- 任务结束后转入 `.codex-memory/tasks/archive/`。

## archive 规则

- 每轮过程、历史补充、旧目标、一次性微调、已失效决策写入 `.codex-memory/archive/`，不要继续堆到 `current.md`。
- 历史归档只用于追溯，不承担当前交接职责。

## 更新时机

- 在长对话、复杂任务、多文件修改、跨多个话题、准备结束当前线程、任务阶段切换、或上下文明显升高时，优先更新 `.codex-memory/current.md`。
- 若当前工作属于某个活跃任务，再同步更新该任务的 `brief.md`、`decisions.md` 或 `refs.md`。
<!-- CODEX-MEMORY:END -->
