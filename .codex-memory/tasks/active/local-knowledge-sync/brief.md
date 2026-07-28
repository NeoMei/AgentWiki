<!-- codex-memory:template=task-brief:v1 -->

# local-knowledge-sync

## 目标

实现本地 Agent 对代码仓库和 Markdown/TXT/PDF/DOCX 资料目录的本地扫描、Wiki 生成、同步前确认，以及确认后的 AgentWiki OKF 导入。

## 当前状态

- 高层方向和本地插件安装体验已由用户确认。
- 正式设计已写入 `agentwiki/docs/superpowers/specs/2026-07-28-local-knowledge-sync-design.md`，用户已最终批准。
- 服务端、本地插件、产品接入三份实施计划已完成并自检；尚未开始产品代码修改。
- 下一步从服务端计划开始执行，再依次进入插件和产品接入。

## 范围

- OpenWiki/OKF、本地 codebase-memory、MarkItDown。
- `@agentwiki/local-sync` Agent Skill、stdio MCP、CLI 和跨 Agent 配置适配器。
- AgentWiki 生成固定版本接入指令和 10 分钟单次安装码。
- 本地预览和明确确认。
- AgentWiki OKF Source、SourceVersion、IngestRun、Evidence、ChangeSet 复用。
- 代码仓库与 Markdown/TXT/PDF/DOCX。

## 不做

- 服务端读取本地路径。
- 图片、音频、视频。
- 默认上传完整源码。
- Graphify、Docling 或第二套审核流水线。
- 第一版原生桌面安装包、静默安装系统依赖或服务端运行本地插件。
