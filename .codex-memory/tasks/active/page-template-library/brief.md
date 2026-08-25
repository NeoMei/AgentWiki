<!-- codex-memory:template=task-brief:v1 -->

# 页面模板库

## 目标

- 为 Space 的“新建页面”增加两步式模板选择。
- 提供空白入口、七个双语系统模板和可版本化的 Space 自定义模板。
- Owner / Admin 管理 Space 模板，Editor 只使用；模板快照不反向修改既有页面。

## 范围 / 不做

- 本期只做单页 Markdown 模板。
- 不做页面套装、个人模板、跨 Space 模板、模板 MCP 或自动翻译。
- 不把页面模板与多 Agent 协作模板混为同一领域。

## 当前状态

- 2026-08-25 已完成逐段设计确认。
- 正式设计：`agentwiki/docs/superpowers/specs/2026-08-25-page-template-library-design.md`。
- 实施计划：`agentwiki/docs/superpowers/plans/2026-08-25-page-template-library-plan.md`。
- 计划已按数据库合同、系统种子、服务端领域、两步弹窗、Space 管理、编辑器入口、独立数据库和真实浏览器验收分解为 13 个 TDD 任务。
- 当前等待用户选择执行方式，产品代码尚未开始修改。

## 完成标准

- 设计获用户书面确认。
- 实施计划覆盖服务端模型、权限、版本、API、前端两步弹窗、模板管理与浏览器验收。
