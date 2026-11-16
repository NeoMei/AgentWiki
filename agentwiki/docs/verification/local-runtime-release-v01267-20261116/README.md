# v0.12.67 Agent 本地网关运行时发布

修复目标：Agent 接入 AgentWiki MCP 时不再在每次宿主启动时联网执行 `npx --yes @neomei/agentwiki-local-sync@<ver>`。改为接入阶段把包一次安装到 `~/.agentwiki/runtime/local-sync-<version>`，宿主 MCP 配置写入绝对 Node 可执行文件与本地 CLI 入口路径。没有科学上网、无法访问 npm registry 的机器，启动 Agent 时不再依赖网络拉取，从而避免 MCP 连接超时。

## 版本与冻结

- Web/Client/API 0.12.67；Local Sync 0.13.6；sync-protocol 0.6.1。
- 修复提交 `2d0c507b`；冻结提交 `f81d952d`；分支 `codex/agent-autochat-external-opencode`。
- npm 包 `@neomei/agentwiki-local-sync@0.13.6` 已发布、registry 可读，`latest` 已指向 0.13.6。
- GitHub Release：https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.67

## 验证边界

本目录脚本提供：从精确冻结 revision 生成源码 manifest 与独立只读 verifier、配对备份与隔离恢复、发布核验。脚本存在、语法检查或 mock 测试通过均不代表生产发布成功。

本轮业务验收关注点：宿主 MCP 配置指向本地绝对运行时路径；断开或屏蔽 registry 后重启 Agent，MCP 仍能连上；不执行任何模型或 Agent 任务。健康检查与单元测试不能替代真实用户验收。

原未跟踪 `agentwiki/design/`（用户草稿）保留，不提交、不打包。备份与生产读回证据在部署阶段生成，不在本目录预置旧成功回执。
