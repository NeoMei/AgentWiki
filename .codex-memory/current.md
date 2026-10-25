# 当前目标

官网名称统一为「AgentWiki」，保留用户确认的极简中国结 Logo，已在 agentwiki.quukk.com 上线；内置Agent自动编辑故障仍以v0.12.59验收记录为准，保留真实业务报告回归边界。

# 范围 / 不做

本轮修复自动意图/最终JSON解析、目录工具启动时序和误称只读权限。未改写原Bug汇总表、未放宽用户角色/绑定目标/CAS、未改provider凭据；Local Sync与protocol不变。

# 当前状态

- 用户最新确认官网只使用「AgentWiki」，去掉天枢/Tianshu文字，保留极简中国结。最终前端源码 `d242c63444705e3d8945424ab952c92c6e5d0e36` 已部署；Logo集成 `d81994d4`。Web/API仍0.12.59。70相关测试、构建、320px本地/390px生产与桌面验收通过，生产10源码/408资源和5health核验一致。配对备份 `/var/backups/agentwiki/tianshu-logo.XDki5U2f`，旧dist `/root/agentwiki/apps/client/dist.before-agentwiki-only-d242c634`。
- canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`；分支 `codex/agent-autochat-external-opencode`；当前Web/API/client **0.12.59**，v0.12.59发布冻结源码 `69520f568f2e1a1682eebcc46d858fe2475b8065`（前端品牌现使用上述后续补丁），lock祖先 `4e2846dd`。GitHub Release/tag已发布。
- 目录generation通过临时插件等待真实tool registry并核验context回执；模型仍仅两个只读工具，业务写入由应用授权/CAS完成。answer只指本轮回答，不是会话永久只读。
- server3593pass/44专用环境skip，独立145pass，typecheck/lint/build通过；CLI2.1.1/2.1.4四项生命周期均pass。上线后真实router+Qwen读取9个各正文随机UUID并返回update；其他目标/viewer/只聊天均answer。
- 生产1425源码与冻结提交一致，三服务、五health、65迁移、HTML/5入口资源均通过。新配对备份 `/var/backups/agentwiki/agent-auto-v01259.z755u0mq` 与previous `/root/agentwiki-previous-20261024043922` 保留，备份校验10/10。
- Local Sync0.13.5仍在release-0-12-57，protocol0.6.1；npm latest此前0.13.4，认证/真实host升级保持独立。

# 稳定约束

编辑/发布前运行release guard；历史主检出禁止发布。生产目标 `root@113.249.120.24:/root/agentwiki`，使用root用户级systemd；外部OpenCode `/opt/agentwiki-opencode/opencode` 2.1.1。Space权限实时查询，写入保留固定目标/CAS；不直接DB改业务正文。恢复必须配对应用、配置、DB及附件并考虑备份后写入。

# 关键索引

- agentwiki/docs/verification/agentwiki-brand-only-20261025/README.md
- tasks/archive/agent-auto-edit-20261024/{brief,decisions,refs}.md
- agentwiki/docs/verification/agent-auto-edit-20261024/README.md
- https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.59
- tasks/active/notification-unread-20261023/{brief,decisions,refs}.md
- tasks/active/bug-report-20261022/brief.md
- tasks/active/release-v01257-20261023/brief.md

# 风险 / 下一步

原业务9篇报告的内容汇总和真实浏览器保存未在本轮执行；router诊断不修改共享Redis健康状态，不等同队列/实时授权/落盘验收。保留一次模型前言导致single-runModel被拒的回执；完整router两次通过，没有伪称实测了自动重试分支。免费备用模型认证失败未改。通知billy人工回归与npm官方WebAuthn仍为独立后续事项。
