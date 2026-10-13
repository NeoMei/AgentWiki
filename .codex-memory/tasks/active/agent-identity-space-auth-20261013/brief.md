# Agent 一次身份接入修正

## 当前目标

用户确认：Agent 一次接入 AgentWiki，每次按目标 spaceId 实时 Grant 授权。不得要求逐空间领取接入码。

## 范围

身份凭据与 Grant 解耦；Grant 变化动态生效；网关单身份传 spaceId；接入/协作准备界面；历史凭据迁移；旧 Tree 工作区保留。本轮本地开发未发布生产/npm，未变更真实本机配置与凭据。

## 当前状态

候选已提交 `c5a2cb75e022d55ba4ab927668c3b705ba4e07b0`，分支 `codex/agent-identity-space-auth`；工作树 `/Users/neomei/.codex/worktrees/agent-identity-space-auth/AgentWiki `（尾空格）。基于 origin/master `6de18645`（v0.12.24）。

完整测试 7,084 通过、6 跳过、0 失败，其中 Runtime DB 232 零跳过；typecheck/lint/build/diff check 通过。服务端、UI、网关独立审查及修复复审通过。两项 UI P2 与旧 Tree workspace P1 均已关闭。详见 agentwiki/docs/verification/agent-identity-space-auth-20261014/status.md。

## 下一步

用户已授权发布。Web 0.12.25 / Local Sync 0.12.0，协议保持 0.6.1。新增 MCP 原页面更新能力经独立审查通过；最终整树测试 7,114 通过、6 跳过、0 失败，typecheck/lint/build 通过。SSH/npm 登录已恢复，配套备份执行中，后续部署、GitHub/npm 发布及真实 MCP 回读须分别记录。

原任务 17 篇模板草稿仍未远程提交。MCP 新增 propose_page_update 并支持创建页 folderId；接入恢复后按原页面 ID 写入并回读。当前正式 0.11.0 网关的 SPACE_CONNECTION_REQUIRED 是旧设计阻塞，不是让用户另领空间连接码的理由。升级原 MCP args 到0.12.0，保留connection/key/Agent，不重新onboard。
