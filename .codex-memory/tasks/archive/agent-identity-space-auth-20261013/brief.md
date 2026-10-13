# Agent 一次身份接入修正

## 当前目标

用户确认：Agent 一次接入 AgentWiki，每次按目标 spaceId 实时 Grant 授权，不需要逐空间连接码。该修正已发布；继续完成原项目模板的 MCP 交付。

## 范围

身份凭据与 Grant 解耦、动态授权、网关单身份、接入/协作界面、历史凭据迁移、旧 Tree 保留；补齐 MCP 按既有页面 ID 更新与创建页 folderId，以完成原文档任务。

## 当前状态

正式提交 `48781e5b192101a2d122dd143048d983bca8a29b`，GitHub Release `v0.12.25`、npm Local Sync `0.12.0` 已发布；protocol `0.6.1` 不变。最终整树测试 7,114 通过、6 跳过、0 失败，typecheck/lint/build 与独立复审通过。

生产迁移与源码/环境/health/网页资产校验通过，旧 71 个 Credential 与 482 个 Grant 的稳定字段未丢失或变化，在线正常新增分别 1 条。原本机 connection/key/Agent 保留，网关升级 0.12.0；真实官方包 stdio MCP 已读取 3 个授权空间，目标 publisher 空间的 15 页、5 目录及首页。没有重新 onboard，也不声称现存 Codex 工具进程热重载。

## 完成结果

目标 Space 的 17 篇最终模板均通过 MCP 正式发布与逐页精确回读。保留 15 个原页面 ID，补 2 个新页面；5 个业务目录、110 内链和 17 页 Agent 审计核验通过。用户明确授权限定范围自动发布，策略已保存。任务 AGW-T-011、用例 AGW-TC-018、反馈 AGW-BUG-012 按实测闭环，历史问题及人类验收边界保留。

首轮请求限流经确认已保存内容后恢复；最终按3.25秒调用间隔完成。旧目录候选保留为已被替代的pending审计，当前聊天旧网关不声称热重载。任务于2026-10-14完成归档。

证据入口：agentwiki/docs/verification/agent-identity-space-auth-20261014/status.md 与 template-final-publication-receipt.json；正式源码仍为48781e5b，后续Git提交只补交付回执。
