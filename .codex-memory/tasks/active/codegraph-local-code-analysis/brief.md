# CodeGraph 本地代码分析替换

## 目标

将 AgentWiki 的本地代码扫描从 `codebase-memory-mcp` 调整为 CodeGraph 扫描、AgentWiki 分析和派生知识同步，同时保持双方版本生命周期解耦。

## 当前状态

- 2026-08-18：设计已获用户确认。
- 已确认标准扫描与显式深度分析双模式。
- 已完成标准扫描切换和可选深度分析两份实施计划。
- 尚未修改产品代码；下一步默认先执行标准扫描切换，深度分析不自动启动。

## 范围

- AgentWiki 内置能力协商型 `CodeGraphProvider`。
- CodeGraph 独立安装、升级和维护 `.codegraph/`。
- `agentwiki-code-snapshot@1` 中立快照。
- 确定性基础分析、可选深度分析和本地 Agent 增强。
- 生成本地 Markdown/SourceArtifact，经 Preview 和确认后同步。
- 完整移除 Codebase Memory 生产路径。

## 不做

- 不上传 `.codegraph` 或原始代码。
- 不自动安装或升级 CodeGraph。
- 不绑定精确 CodeGraph 版本。
- 不自动执行深度分析。
- 不保留 Codebase Memory 回退。

## 验收方向

- 标准扫描在三种 Agent 客户端完成真实本地扫描和同步。
- 深度分析只有用户明确要求并确认计划后运行。
- 同一快照生成确定性输出。
- 普通扫描不误删既有深度分析知识。
- 生产路径不再引用或安装 `codebase-memory-mcp`。

## 实施计划

- 第一阶段：`agentwiki/docs/superpowers/plans/2026-08-18-codegraph-standard-scan-cutover.md`
- 第二阶段（仅用户主动要求）：`agentwiki/docs/superpowers/plans/2026-08-18-codegraph-optional-deep-analysis.md`
