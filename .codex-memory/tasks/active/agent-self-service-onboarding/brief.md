<!-- codex-memory:template=task-brief:v1 -->

# agent-self-service-onboarding

## 目标

实现从网页 Device Auth、Agent NDJSON 填空、一次接入计划确认、单一本地 gateway MCP 安装，到首次本地扫描、知识预览确认和同步的完整 Agent 自助接入流程。

## 当前状态

- 2026-08-10：用户已确认完整流程、网页 Auth、汇总预览一次确认、NDJSON 填空协议、单一本地网关 MCP、确定性执行平面路由、防卡死安装状态机、恢复与测试边界。
- 正式设计已写入 `agentwiki/docs/superpowers/specs/2026-08-10-agent-self-service-onboarding-gateway-design.md`。
- 当前只完成设计，尚未进入实施计划和代码实现。

## 范围

- Device Auth 与最小权限 onboarding token。
- bootstrap 幂等创建/复用 Space、Agent、Grant 和安装凭据。
- `@neomei/agentwiki-local-sync@0.3.0 onboard` NDJSON/human 协议。
- 单一 `agentwiki` stdio gateway MCP。
- `wiki_*`、`local_*`、`knowledge_*` 确定性路由。
- 三类 Agent 客户端的原子安装、验证、恢复和 reload 处理。
- 首次本地扫描、知识预览、确认同步和生产受控 E2E。

## 不做

- 服务端读取本地文件。
- 上传原始代码、原始文档、原始 Agent Memory 或凭据。
- 依赖自然语言提示词保存状态或选择 MCP。
- 本地端口、daemon、服务端反向控制或未确认上传。
- 为 0.2.9 双 MCP、`connect`、旧工具 alias 或旧 job 状态提供向下兼容。
