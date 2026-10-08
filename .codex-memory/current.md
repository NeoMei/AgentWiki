# 当前目标

- 完成10-08测试报告15项的本地修复候选、独立审查和验收记录。

# 范围 / 不做

- 本轮交付本地候选；尚未合并主检出、推送、发布或部署。精准恢复授权不扩展为功能发布授权。
- 未复现原案保留待验，代码、自动测试、真实UI与部署分别记录。

# 当前状态

- 网页工作树 `/Users/neomei/.codex/worktrees/test-fixes-20261008/AgentWiki `，分支 `codex/test-fixes-20261008`，基线生产v0.12.16/d78c4af；最终产品源码d6c3934a。本地主检出仍0.12.12，不是候选。
- 六组修复已实现并独审通过，最后整分支源码审查及插件双语提示复审无开放新增问题。目录/菜单、模板绑定能力、编辑器、协作卡片及导航已集成。
- root全仓测试6952通过/6跳过/0失败；runtime数据库230零跳过，Chrome15/15、完整PageEditor显式保存/回读通过。六条跳过为2条Windows原生、1条独立CodeGraph验收、3条专用连接授权门禁，不能称全部零跳过。
- 构建体积问题已修：仅搬移协作lookup，225条映射与双语各229条翻译不变；最终d6c3934a前端2234项及生产预览通过，root完整build通过，首屏542577/550000。限定独审C/I/M=0/0/0；原全仓6952项证据为167237a1，未冒称最终增量重跑后端/数据库。
- Obsidian独立工作树 `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/.worktrees/test-fixes-20261008`，最终候选d1d89de；npm run check 1418项通过，独审通过。原生macOS Sync V2首次同步/自动建嵌套映射目录/再次无差异通过，原生证据属于e5b8a3a，最终提交仅补双语提示。
- 原测试者Obsidian UNKNOWN_PARENT、原始黄金书屋Space案例、原生中文IME及真实provider会话仍有待验边界；当前账号无原Space权限。
- 误删旧测试页3300a11b-0daf-4617-8e4c-ff008e069b85已于19:09按原ID恢复；正文hash、历史、派生索引、同步及真实原URL/搜索回读通过。新报告未改；恢复已完成，禁止重复执行恢复脚本。

# 稳定约束

- 路径末尾有空格；所有worktree git命令显式work-tree并使用正确cwd。
- 只用隔离合成测试数据；权限/allowlist、显式Save、旧链接与同步数据保留约束不变。
- 凭据不进入文档或Git。原生fixture设备已撤销、本地断开，日常Vault与Obsidian主进程保留；验收引起的CLI socket影响已恢复。自建API3191、Vite5191/5192、Redis6391/6392与preview5197均已关闭；隔离数据保留。

# 关键索引

- .codex-memory/tasks/active/test-triage-20261008/brief.md
- 主检出 agentwiki/docs/research/test-triage-20261008/triage.md 与 recovery-receipt.json
- 修复工作树 agentwiki/docs/verification/test-fixes-20261008/status.md、gate-results.json、receipts/
- 修复工作树 agentwiki/docs/superpowers/plans/2026-10-08-test-fixes.md 与 .superpowers/sdd/2026-10-08-test-fixes/progress.md

# 风险 / 下一步

- 已完成授权的本地修复、独审与验收阶段；保留网页/插件候选工作树和脱敏交付记录。原案复验待测试者版本、日志/树结构与原Space访问；发布部署尚未执行。
- 既有网页lint3条、插件lint19条、插件安装audit10项另列，不因本次修复宣称已消除。
