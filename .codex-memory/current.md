# 当前目标

内置 Agent 自动编辑失败已完成候选修复及真实Qwen合成目录验收；用户已确认现在发布v0.12.59，正在备份与冻结发布源码。

# 范围 / 不做

修复自动意图/JSON最终响应解析、目录工具启动时序与错误权限解释。本轮未改写原Bug汇总表、未放宽角色或写入权限、未修改provider凭据，尚未部署。

# 当前状态

- canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`；分支 `codex/agent-autochat-external-opencode`；本轮起点HEAD `4e2846dd`，release guard通过。
- 当前线上仍Web/API v0.12.58，发布源码 `19da88ebc90c9213a3835403c69f60e3669c5d86`，lock基线 `ec4faa7f`。通知未读计数补修和原报告回写已发布；billy人工复验独立待记录。
- 本轮候选：单个完整JSON围栏兼容、仅解析最终步骤、目标标题metadata、正确说明answer/应用写入；v2目录请求等待真实tool registry并校验context能力回执，保留deny-all与两个只读工具。
- 服务端3593pass/44专用环境skip、独立145pass、typecheck/lint/build/diff-check通过。真实Qwen+生产同版CLI2.1.1：list1/read9、9个正文marker全覆盖、update通过；其他页/viewer/只聊天均answer。未执行真实用户浏览器保存。
- Local Sync0.13.5仍在release-0-12-57，npm latest此前0.13.4；npm认证与host升级验收保持独立。

# 稳定约束

编辑/发布前运行release guard；生产目标 `root@113.249.120.24:/root/agentwiki`。当前外部OpenCode在 `/opt/agentwiki-opencode/opencode`，版本2.1.1。用户角色/Space权限实时检查，页面写入保持绑定目标与CAS，不用DB直接改业务正文。发布恢复需考虑配对备份和备份后写入。

# 关键索引

- tasks/active/agent-auto-edit-20261024/{brief,decisions,refs}.md
- agentwiki/docs/verification/agent-auto-edit-20261024/README.md
- tasks/active/notification-unread-20261023/{brief,decisions,refs}.md
- tasks/active/bug-report-20261022/brief.md
- tasks/active/release-v01257-20261023/brief.md

# 风险 / 下一步

候选修复未提交或部署；用户已批准发布v0.12.59，生产部署与上线后验证待完成。发布前后须保留版本、备份与服务健康检查，生产真实浏览器保存和原9篇业务内容验收另行记录。免费备用模型auth_failed仍是独立环境问题。通知人工复验及npm latest官方WebAuthn保持独立，勿复用旧认证链接。
