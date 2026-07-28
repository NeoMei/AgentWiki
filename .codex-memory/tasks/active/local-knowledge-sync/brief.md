<!-- codex-memory:template=task-brief:v1 -->

# local-knowledge-sync

## 目标

实现本地 Agent 对代码仓库和 Markdown/TXT/PDF/DOCX 资料目录的本地扫描、Wiki 生成、同步前确认，以及确认后的 AgentWiki OKF 导入。

## 当前状态

- 高层方向已由用户确认。
- 正式设计已写入 `agentwiki/docs/superpowers/specs/2026-07-28-local-knowledge-sync-design.md`，等待用户书面复核。
- 尚未进入实现计划或代码修改。

## 范围

- OpenWiki/OKF、本地 codebase-memory、MarkItDown。
- 本地预览和明确确认。
- AgentWiki OKF Source、SourceVersion、IngestRun、Evidence、ChangeSet 复用。
- 代码仓库与 Markdown/TXT/PDF/DOCX。

## 不做

- 服务端读取本地路径。
- 图片、音频、视频。
- 默认上传完整源码。
- Graphify、Docling 或第二套审核流水线。

