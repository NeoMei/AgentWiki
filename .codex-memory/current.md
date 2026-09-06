<!-- codex-memory:template=current:v1 -->

# 当前目标

- A+ 方案实现与本地验收完成，保留功能分支等待用户选择整合方式。

# 范围 / 不做

- 统一单页面、多页面和可选 Agent 协作的模板事实源；支持历史页面后绑定、按任务纳入参与 Agent、从现有目录保存 Space 模板。
- 设计复用既有内容树、协作运行和 ChangeSet 审核，不新建巨型状态机。
- 本阶段实现与本地验收；不 push、不发布 npm、不部署生产。
- 不修改 Folder 同步语义、附件、Markdown 图片引用或 Sync v3 协议；若实施发现必须触及，停止并重新申请范围授权。

# 当前状态

- 用户已逐项确认：组合领域模型、原子实例化、单次页面审核、三步创建交互、历史页面后绑定、按任务纳入 Agent、保存目录模板、兼容迁移与回滚；实施已授权，按计划持续推进。
- 正式设计文档已生成：`agentwiki/docs/superpowers/specs/2026-09-05-composite-page-group-agent-collaboration-templates-design.md`。
- 文档自检已明确：绑定可保存暂时离线但合规的长期负责人；启动 Run 必须通过既有准备检查；保存现有目录时协作定义必须有显式来源。
- 设计已在隔离分支 `codex/composite-page-group-agent-collaboration-design` 提交为 `d5538e5`；其父提交 `711cae7` 与本地 `master`、`origin/master` 和 `codex/technical-debt-integration` 当时一致，未开始实现。
- 已在现有 Codex 隔离 worktree 切换到 codex/composite-page-group-agent-collaboration；fetch 后主线仍为 711cae7。
- Task 1–13实现与各任务独立审查均完成。唯一整分支审查5 Important/4 Minor经单批修复提交17f28da，唯一限定复审9/9全部关闭，无新阻塞问题；代码审查结论Ready to merge。最终types/lint/build/test:full均exit0：4861pass/0fail/3既有skip，DB167零skip。尚未实际合并、推送、发布或部署。
- 已有真实Chrome关闭协作创建多层树/普通编辑，以及开启协作角色去重/Run创建证据；Codex首次与审核后恢复两阶段、OpenCode独立一阶段均真实MCP提交并由Chrome人类审核发布。Claude401且一次OAuth回退明确未登录，未修改账户；采用现有OpenCode合法route。各次独立fixture、失败轨迹与回执见task-13b-report.md，不能误称一条共同Run；最新六旅程证据需在fix1强化harness后复验。
- 本计划进度账本：.superpowers/sdd/2026-09-05-composite-page-group-agent-collaboration/progress.md；按该账本恢复，不重做已完成任务。
- 专用容器 agentwiki-composite-69d8-db（PostgreSQL16+vector，当前端口50415，数据库agentwiki_composite_test）与 agentwiki-composite-69d8-redis（50416），仅本任务使用。原容器HostPort为空随机映射，2026-09-05约19:03 Docker停止后重启导致端口从62341/62342改变；每次重启用docker inspect重新解析，不重建数据库，结束时精确清理。
- 专用数据库hnsw.ef_search=200，protected public仍0表；API/worker验收环境的付费embedding/graph配置显式关闭，外围语义任务降级不能报告为健康。

# 稳定约束

- 一个不可变组合 TemplateVersion 是页面结构和可选协作定义的模板事实源；内容树、CollaborationRun、ChangeSet/Review 保持独立运行时。
- Folder 只表达真实目录结构，不绑定 Agent 或任务；只有 Page 可以绑定长期主责 Agent 和成为任务目标。
- PageAgentBinding 不授予权限；活动 Run 冻结负责人；本次参与 Agent 只来自启用任务并按 Agent 去重。
- 外部 Agent 沿用原 waiting_human/paused 安全退出协议；“每 Agent 一份合并指令”指开始或人工审核恢复后的执行阶段，不承诺跨审核自动远程唤醒，UI必须保留明确恢复指令。
- 页面目标任务提交创建 Artifact + ChangeSet；一次人类审核原子决定协作接受与 PageVersion 发布；冲突不得覆盖。
- 模板实例化的 Folder、Page、Binding、Run 和一次 tree revision 全有或全无；外围索引/图谱/Socket 在提交后重试。
- 旧单页自动兼容；旧运行不改写；系统协作模板发布组合新版；Space 自定义旧流程显式升级。
- `AgentGrant.role` 仍是唯一持久化权限事实，任何 Agent 都没有 `review:decide`。

# 关键索引

- 正式设计：`agentwiki/docs/superpowers/specs/2026-09-05-composite-page-group-agent-collaboration-templates-design.md`
- 实施计划：`agentwiki/docs/superpowers/plans/2026-09-05-composite-page-group-agent-collaboration.md`
- 活跃任务：`.codex-memory/tasks/active/composite-page-group-agent-collaboration-templates/`
- 旧页面模板设计：`agentwiki/docs/superpowers/specs/2026-08-25-page-template-library-design.md`
- 旧协作模板设计：`agentwiki/docs/superpowers/specs/2026-08-22-agent-collaboration-templates-design.md`

# 风险 / 下一步

- 实施计划已可供执行，包含旧 Run 模板外键、一事务页面发布、按 Attempt 基线和安全开关回滚的具体任务。
- 实施阶段已完成；下一步由用户选择本地合并到master、推送并建PR或保留分支。任何发布/生产操作仍需独立授权，不将“继续”设计讨论误读为已部署。
- 当前共享 Git 配置的 `core.worktree` 指向原始检出路径；每次Git必须显式指定该隔离 worktree，不修改共享配置，不处理plain-git呈现的虚假删除。
- 从progress.md、final-fix-report.md、final-fix-rereview-instructions.md恢复；唯一复审输出final-fix-review.md。最终修复门禁详见已跟踪agentwiki/docs/verification/composite-template-final-review-fixes.md；runtime235pass1skip、DB167pass0skip、server2233pass1skip、client1246、protocol103、local-sync877pass1skip。3skip为CodeGraph opt-in、Windows OpenCode执行、Windows ACL。控制器冻结提交后另验pure45/45、client41/41、整分支diffcheck0；public0表、randomschema0、额外connection0。
- 最新严格Chrome证据/tmp/agentwiki-final-fix-chrome4：六旅程、main2Pages/feature-off1Page、零pageerror/unknownconsole、精确3次409及console归因、CLEANED；新保存目录4Pages/1role/7节点，JSON单页元信息/v2/归档和系统日期标题真实UI完成。Chrome2曾因响应先于console结束动作导致归因失败，已用15s精确事件barrier和延迟事件负例修复，失败trace保留。浏览器feature-off完成历史page_selection Run；完整composite Run发布另由effects-policy DB gate证明。
- 整分支5项Important（实时权限、adopt_current回执、兄弟顺序、裁剪后职责、普通页面）和4项Minor（文字预算、标题插值、JSON单页管理、EOF）均经final-fix-review.md关闭。final-branch-review.md保留历史延期裁定，final-fix-report.md保留RED/GREEN和新门禁；不重开同一实施波次，不删除未合并分支的独有证据。
- 实施不得触碰 Sync v3、附件或 Markdown 图片引用；相关需求必须拆为独立任务。
