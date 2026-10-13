# Agent 一次身份接入修正

## 当前目标

用户确认：Agent 一次接入 AgentWiki，每次按目标 spaceId 实时 Grant 授权，不需要逐空间连接码。该修正已发布；继续完成原项目模板的 MCP 交付。

## 范围

身份凭据与 Grant 解耦、动态授权、网关单身份、接入/协作界面、历史凭据迁移、旧 Tree 保留；补齐 MCP 按既有页面 ID 更新与创建页 folderId，以完成原文档任务。

## 当前状态

正式提交 `48781e5b192101a2d122dd143048d983bca8a29b`，GitHub Release `v0.12.25`、npm Local Sync `0.12.0` 已发布；protocol `0.6.1` 不变。最终整树测试 7,114 通过、6 跳过、0 失败，typecheck/lint/build 与独立复审通过。

生产迁移与源码/环境/health/网页资产校验通过，旧 71 个 Credential 与 482 个 Grant 的稳定字段未丢失或变化，在线正常新增分别 1 条。原本机 connection/key/Agent 保留，网关升级 0.12.0；真实官方包 stdio MCP 已读取 3 个授权空间，目标 publisher 空间的 15 页、5 目录及首页。没有重新 onboard，也不声称现存 Codex 工具进程热重载。

## 下一步

用户已明确允许 Publisher 自动发布。主代理正在应用审核政策并用 MCP 更新 17 篇模板。现有目录改名提案回执仍为 pending_review，不能算正式发布。按原页面 ID 更新，创建缺失的测试报告/开发日志，补真实文档链接并逐页正式回读后再关闭文档任务。

证据入口：agentwiki/docs/verification/agent-identity-space-auth-20261014/status.md 与 publication-progress.json；生产/npm/GitHub/本机升级/MCP实读均有独立 sanitized receipt。
