# 通用 MCP 接入与 WorkBuddy 反馈修复

目标：修复三客户端限制、手动复制授权 URL、客户端权限与重启提示不清，以及 Node 预检、doctor 范围、CLI 参数和帮助问题。

状态：隔离候选基于 origin/master 9851195e；源码实现、独立审查、本地 CLI 和真实 Chrome 验收完成，最终整包1071/1skip、服务端271/3skip、前端82、runtime33通过，typecheck/lint/build通过。主检出用户修改保留，未发布 npm/部署生产，也未改本机 WorkBuddy/Codex 配置。

交付与证据：agentwiki/docs/verification/generic-mcp-onboarding-20261018/{acceptance.md,review.md,browser-qa.md,browser-opener.json}。

下一步：正式发布时必须先提升 Local Sync 新版本并同步 Web/API 版本、服务端允许范围及精确版本命令，再执行正式打包/发布/部署门禁。现有已发布0.13.1不含此候选功能；原 WorkBuddy 安装、用户许可、重载后真实页读取仍待验。
