<!-- codex-memory:template=task-brief:v1 -->

# agent-self-service-onboarding

## 目标

实现从网页 Device Auth、Agent NDJSON 填空、一次接入计划确认、单一本地 gateway MCP 安装，到首次本地扫描、知识预览确认和同步的完整 Agent 自助接入流程。

## 完成状态

- 2026-08-11 完成 4 个里程碑、11 个 TDD Task，并完成多轮任务、代码和功能审查。
- `@neomei/agentwiki-local-sync@0.3.1` 已发布到 npm，`latest=0.3.1`。
- 生产已部署 0.3.1，迁移、健康检查、版本契约和 HTTP 410 退役接口均验证通过。
- Codex、Claude Code、OpenCode 已用 npm 公网包分别完成隔离 HOME 全流程 E2E；Playwright 生产 Device Auth UI E2E 通过。
- 最终测试：runtime 67 pass/9 skip、server 486、client 160、local-sync 317；typecheck、lint、build 全通过；0 high/critical audit。
- 完整证据见 `agentwiki/docs/verification/agent-self-service-onboarding-0.3.1.md`。

## 已实现范围

- Device Auth 与最小权限 onboarding token。
- 事务化、可重放 bootstrap；每个 device session 独立 Agent、Grant 和安装凭据。
- `@neomei/agentwiki-local-sync@0.3.1 onboard` NDJSON/human 协议。
- 单一 `agentwiki` stdio gateway MCP，以及 `wiki_*`、`local_*`、`knowledge_*` 确定性路由。
- Codex、Claude Code、OpenCode 原子安装、验证、恢复和 reload 处理。
- 首次本地扫描、知识预览、确认同步、失败清理与生产受控 E2E。
- Markdown/TXT 快速路径；MarkItDown runtime 仅在 PDF/DOC/DOCX 时按需安装。

## 不做

- 服务端读取本地文件。
- 上传原始代码、原始文档、原始 Agent Memory 或凭据。
- 依赖自然语言提示词保存状态或选择 MCP。
- 本地端口、daemon、服务端反向控制或未确认上传。
- 为 0.2.9 双 MCP、`connect`、旧工具 alias 或旧 job 状态提供向下兼容。
