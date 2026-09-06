<!-- codex-memory:template=current:v1 -->

# 当前目标

- 组合式单页/多页面模板与可选 Agent 协作已完成本地整合；本地 master 已快进到通过审查和主目录验收的 f84d576e，最终文档交接提交不改产品。
- 本次范围已完成；后续 push、npm 发布、生产部署需要新的明确请求。

# 范围 / 不做

- A+ 统一组合 TemplateVersion，创建真实多层 Folder/Page 树，支持历史页面后绑定和按任务纳入参与 Agent。
- 已整合 v0.8.0 及最终锁定的上游 e0f7acaf（PR9 legacy v3 Space-list root-null/date 修复）。
- 本任务没有 push、发布、部署、生产迁移、账户修改或付费模型重放；其他并行任务的上游发布不属于本任务执行。

# 当前状态

- 原 Task1–13、17f28da 最终功能修复与9/9限定复审已完成，不重做。
- 双父整合069eb126、证据文档修复fe99a4ac及最后上游合并1a25bfb5/文档f84d576e全部独立审查通过，无 Critical/Important/延期问题。
- 主目录 master 从711cae7快进到f84d576e；主目录 frozen install、依赖预构建、typecheck/lint/build/test:full 均已完成，最终命令exit0。
- 新鲜主目录结果：5212pass/0fail/3明确skip；runtime257+1、DB175零skip、server2499+1、client1264、protocol140、local-sync877+1。三个skip为CodeGraph opt-in/Windows OpenCode/Windows ACL。
- 首次main typecheck因旧protocol dist缺导出exit2；源码具有新导出，预构建shared/protocol后通过，无产品修复。失败日志与成功日志分开保留。
- Chrome6旅程与390px英文/键盘、3次精确预期409、0未知console/pageerror已在069eb126执行并CLEANED。最后2表达式非UI热修复有真实HTTP2/2和完整测试，未宣称另跑最终源码Chrome。旧Codex/OpenCode真实模型回执保留为不同历史fixture证据。
- 主目录46个原有文件哈希、5脏子模块HEAD/status/diff、原status哈希全部保留；未stash/clean/reset/submodule update。独立hotfix工作树由另一任务推进，本任务未修改。
- 专用PG50415数据库agentwiki_composite_test和Redis50416保留；post-main public0表、随机schema0、额外connection0，protected digest887e5d38ed14a3945866940b88cb74236e4f56f7636235f53d289095ba0ef73b保持。工作树及唯一验收资料保留。

# 稳定约束

- Folder只表达目录结构；只有Page可以绑定Agent或成为任务目标。
- PageAgentBinding不授予权限；活动Run冻结负责人；参与者仅来自本次启用任务并按Agent去重。
- 模板实例化Folder/Page/Binding/Run和一次tree revision全有或全无；外围任务提交后重试。
- 页面目标产物走Artifact+ChangeSet+一次人类审核；实时权限与版本冲突检查不得绕过，精确receipt重试保留。
- 旧单页/旧Run兼容，历史页面可后绑定；Space旧流程显式升级。
- v3已发布ChangeSet禁止旧入口回滚；协作候选不可走普通入口绕过协作审核发布。
- AgentGrant.role是权限事实源，Agent没有review:decide；外部Agent人工审核后的恢复仍需用户明确唤醒。

# 关键索引

- 最终本地合并验收：`agentwiki/docs/verification/composite-v080-master-merge.md`
- 完整整合证据：`agentwiki/docs/verification/composite-v080-local-integration.md`
- 设计：`agentwiki/docs/superpowers/specs/2026-09-05-composite-page-group-agent-collaboration-templates-design.md`
- 本轮计划：`agentwiki/docs/superpowers/plans/2026-09-06-composite-v080-local-integration.md`
- 已完成任务：`.codex-memory/tasks/archive/composite-page-group-agent-collaboration-templates/`
- 隔离工作树执行账本：`.superpowers/sdd/2026-09-06-composite-v080-local-integration/progress.md`

# 风险 / 下一步

- 不自动发布。后续发布必须重新核对远端、版本、生产备份、灰度与实际线上验收，不能把本次本地通过当作上线。
- 主目录真实路径和本任务worktree都以空格结尾；共享core.worktree指向主目录，每次Git显式--work-tree，不修plain git产生的虚假删除。
- Vite保留既有chunk-size建议；测试负例WARN/ERROR已分类，不代表零警告输出。
- 最终文档提交仅更新交接/归档和本地合并证据，产品树与已通过5212测试的f84d576e一致。
