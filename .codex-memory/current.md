# 当前目标

内置 Agent 多轮审查、追加修复和发布已完成。线上与GitHub latest均为v0.12.62，冻结提交2635bc66dd669d94f00650d3488f62e455719cab。任务：tasks/archive/agent-audit-release-20261026/brief.md。

# 范围 / 不做

覆盖会话状态、清空/历史/取消/引用UI、REST类型与来源权限、队列恢复和租约、OpenCode流解码及最终结果。保持权限/写入保护。生产浏览器仅创建2个隔离空会话，原页面标题/正文/版本未变；真实模型验证使用合成短文档，不写业务数据库/Redis/Page。

# 当前状态

- ee955c72完成前四轮审查修复；追加审查修复同worker重领租约后旧attempt覆盖新attempt，1a6de6c8，2红转绿且独立复审通过。
- 最终全仓8375通过/0失败/5既有条件跳过；build/typecheck/lint/release guard全部通过。
- 2635bc66从干净detached检出部署，tag/Release target与生产一致。Host1437源文件/包版本全匹配，3服务active、5healthok，公网HTML/5入口资源匹配。GitHub正式Release为latest、非草稿、非预发布。
- 生产question/proposal/auto-answer真实模型合成烟测3/3通过，共33.935秒；中文/emoji/nonce、proposal完整保留断言通过。provider usage零不代表免费。
- 生产BrowserSkill清空、草稿/历史保留、Tab/ShiftTab、刷新后的会话/来源验收通过；session已停止。临时本地测试数据库和detached发布工作树已清理。

# 稳定约束

canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`，分支 `codex/agent-autochat-external-opencode`。编辑发布前运行release guard；历史检出禁止发布。deploy.sh打包工作树，必须从冻结提交的干净detached检出部署。生产root@113.249.120.24:/root/agentwiki，root用户级systemd、外部OpenCode2.1.1。中文“天枢”、英文“AgentWiki”，中国结Logo。Local Sync0.13.5 / protocol0.6.1。保留未跟踪design/。

# 关键索引

- tasks/archive/agent-audit-release-20261026/{brief,decisions,refs}.md
- tasks/archive/agent-audit-20261026/{brief,decisions,refs}.md
- agentwiki/docs/verification/agent-audit-v01262-20261026/{README,release-tools}.md及JSON回执
- agentwiki/apps/client/src/features/agent-session/；agentwiki/apps/server/src/assist/
- https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.62

# 风险 / 下一步

本轮授权工作已完成。配套备份 `/var/backups/agentwiki/agent-audit-v01262.7nox7xx3`，前应用树 `/root/agentwiki-previous-20261026063503`；恢复须配对数据。短合成模型与成功执行不证明原Bug汇总表的逐项语义完整，原表核对仍独立。免费备用模型认证、通知浏览器回验和npm认证为独立事项。
