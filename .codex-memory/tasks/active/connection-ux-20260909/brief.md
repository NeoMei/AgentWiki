# 接入体验根本改造

## 目标
用户确认：Obsidian 浏览器授权自动连接；Agent 可恢复分步接入，连接与知识导入分开，实际客户端读取验证。

## 状态
实施中。主集成分支 codex/connection-ux-20260909，主基线 bbe5c1f5，插件基线7f628b5。已提交规格40700650、恢复约束0d7c2748。

## 实现分工
- server_auth: connection-ux-server-20260909 工作树，服务端Obsidian purpose、Agent agent-connect 重放/renew/空间列表。
- cli_steps: connection-ux-cli-20260909 工作树，onboard start/status/continue JSON。
- obsidian_connect: 独立插件仓 .worktrees/connection-ux-20260909，插件主连接流程/生命周期。
- 网页任务待空闲实施席位；CLI接口已记录，服务端接口冻结。

## 验收
本地预览5198/API53098；独立PG55448/Redis56398，两个DB原56迁移，无schema变化。基线页面16/16、shared/protocol/server构建通过。候选尚未整合、未公开发布/生产部署。

## 恢复入口
读 refs 和中央 `.superpowers/sdd/2026-09-09-connection-ux/progress.md`；不要重复派已完成任务。旧 reading 工作树/环境、HANDOFF.md、原Vault与知识内容均保留。
