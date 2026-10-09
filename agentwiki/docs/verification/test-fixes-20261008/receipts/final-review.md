# 最终整分支独立审查

## 身份与方法

- 主仓库：`d78c4af9803068216486258f2c4fcc971c38c766..b5446f7d7cd7038ffaa2db3c61f3893d96aaf53e`，追加只改测试的 `b5446f7d..167237a1d70b36a9dfb05a97438717a01b714201`。
- 插件：`ece5544ec3e33f53f79705060077423748c01844..e5b8a3a2624b5208d16a656d15ccd194d2805fd7`。
- 唯一最终 reviewer 独立分段读取冻结 diff；先审实现，再核对测试和任务回执。只对具体风险补读权限、页面快照与插件合并调用边界。没有派代理、改产品代码/Git、重跑已有全套测试。仅写本审查报告。
- 范围不含 root 正在编写的验收文档；完整门禁结果待 root 核对。以下“源码批准”不代表已合并、已部署或原报告所有环境闭环。

## Strengths / Spec alignment

1. **目录和公共菜单（#1/#10/#12/#13/#15）符合核心要求。** `TreeActionMenu.tsx:6` 统一 ContentTree 消费者的互斥、外部点击、Esc、动作后关闭和键盘操作；旁侧定位留出相邻动作列。`ContentTree.tsx:504` 使用 React 文本/mark 和字面量匹配。`useSpaceDirectory.ts:64` 保留原始错误并用当前语言转译，撤权仍清空目录。SpaceDirectory 删除重复全局搜索，SpaceView 标题不再被折叠目录宽度挤到单字。真实几何回归包含普通点击与命中元素检查，没有用 force click 掩盖原遮挡问题。
2. **编辑器和会话跟随（#9/#11）符合要求。** `MarkdownWorkspace.tsx:319` 固定语言/parser 身份；`:354` 仍在正文、语法树和活动行变化时更新装饰；`:924` 保留 pages/resources 动态依赖。没有禁用 Markdown、改变显式 Save、候选应用或历史语义。`AgentSessionPanel.tsx:35` 的初入/切换跟随、发送成功跟随、80px 近底阈值及 ResizeObserver/rAF cleanup 相互配合。测试既检查源码和 Undo，也检查实际浏览器锚点与 resolver 失效；原生拼音输入法仍须单列待验。
3. **模板能力（#3/#14）生产和消费一致。** `template-feature-policy.ts:19` 将普通内容写、定义管理、目录快照、纯绑定、启动拆开；没有放宽 allowlist。`compositeTemplateApi.ts:46` 缺失字段按 false；PageEditor、SpaceView、绑定对话框、模板管理与旧流程升级分别消费对应能力。补读真实授权实现确认 admin 在 editor 许可集合中的合法扩展；角色矩阵测试用真实 AuthorizationService，而非仅 mock 能力结果。TemplateFeaturePolicy 已有模块注册。
4. **系统协作、本地化与审核（#4/#5/#6）符合安全契约。** `run.service.ts:1211` 从实际存储的系统模板关系投影来源，显式 null 阻止自定义模板仅因文字相同而被翻译；用户名称/产物标题保留。`ReviewPanel.tsx:34` 分离 canDecide 与 canApprove，pending 稳定前置，动作位于卡片头部；冲突不批准，但退回/终止/恢复可达。`RunDashboard.tsx:173,292,354` 在权限变化和提交时复核能力。`review.service.ts:250-350` 的 waiting_review 扩展保留真人/Space/指定审核人、Link 所属、当前任务与审核代次、真实 Artifact/Attempt 冻结基线差异和页面 CAS；同一 Serializable 事务内才允许生成新版本/恢复，没有增加自动批准或发布。补读 `page-result.service.ts:151` 核实两次快照读取均校验版本及哈希。长文换行、min-width/grid 比例与真实 1912/1280/390 几何测试相符。
5. **图谱与来源运行导航（#7/#8）符合要求。** `graphLabelLayout.ts:11` 默认无标签，过滤唯一选中节点并在拥挤场景限界回退；原点击/缩放处理保留。`SourcesPage.tsx:13` 保留旧查询式和路径式 run 深链接及其他 query，通过 replace 进入来源运行 tab。直接复用 RunsPage，因此跨来源、重试、取消和原授权路径没有分叉；App 回归执行真实 LegacyRunsRoute，保留空间身份与 foreign-run 隔离断言。
6. **插件树合并（#2）符合数据保留目标。** `src/core/merge.ts:379` 保留实际 local/remote 删除候选；`src/application/tree-diff.ts:235` 恢复完整祖先链并产生冲突；显式删除仍有后代时拒绝，真正未知父目录仍拒绝。resolution 重算成功才替换预览；实际本地缺失产生 create_directory，保留稳定 ID、路径校验、V2/V3 与原协议。新增测试覆盖反方向、本地现存文件、手动移位、child-first 分页、首次全量、父先子后执行。原首次失败报告不因此自动闭环。
7. **Task7 测试收尾合理。** 两处旧顶部 Runs 断言改为来源 tab 契约，未删除身份/权限断言。追加 `node-runtime-contract.test.mjs:696` 使用已有 semver 依赖验证根版本有效且三应用包规范版本一致，独立 Sync 0.11.0、协议 0.6.1 和环境断言不变；没有改版本/依赖/产品。33/33 单文件 GREEN 仅解除该旧断言失败，不代替完整门禁。

## Issues

### Critical

无。C = 0。

### Important

无新增代码或跨任务契约阻塞。I = 0。

### Minor

**M1：插件新增依赖冲突提示缺少英文。** 插件 `src/application/tree-diff.ts:242` 的 `FOLDER_HAS_DEPENDENTS` 文案只有中文，`src/core/user-errors.ts:165` 将其原样返回到 Notice。对删除有后代目录的英文用户，缺少本轮全局约束要求的英文说明。插件原有错误体系也是中文，但不能据此声称新增文案完全满足双语要求。建议仅给此错误补齐中英双语文本并保持错误码/合并逻辑不变，不需引入插件级 i18n。本项不影响数据安全，root 已决定最小修正，修正后做限定复核。

**当前新增 findings：C/I/M = 0/0/1。** 下面两类既有工程告警不混入新增产品缺陷数量。

## Deferred minor 与既有风险 triage

- **Task1/2/5 的 NO_COLOR/FORCE_COLOR：关闭为本轮环境噪声已处理。** 最新集成 15 case 回执明确清除冲突变量且无该 warning，旧日志作为历史证据保留；无需改产品。
- **Task5 circular chunk / large chunk：保留 deferred，非阻塞工程 Minor。** 两类都需写入最终构建回执；本 diff 未改打包配置，无证据表明新增运行故障。以后以启动/加载故障或性能预算决定优先级，不以绿色 build 擦除 warning。
- **Task6 19 lint warnings：保留 deferred，非阻塞工程 Minor。** 任务回执明确全部在未改文件且零 errors；不能描述为“无告警”。
- **主仓库全 lint 3 warnings：保留 deferred，非阻塞工程 Minor。** root 最终回执 exit 0 / 0 errors；`agent.service.ts:155,601` 的 isSuperAdmin 与 `project-taskboard.service.ts:196` 的 takeover 均为未改文件中的既有 unused 告警。typecheck exit 0；不把 lint 通过描述成零告警。
- **Task6 安装 audit 10 项：保留既有依赖风险，严重性未在本审查重定级。** 没有改依赖/lockfile，本轮不是安全扫描，不能把“10 项”直接称为 10 个低危或证明安全。另行按实际 advisory/可达性处置，不扩大本次合并修复。

## 验证事实与未验边界

- 已读各任务回执与相关回归代码：Task2 312、Task3 243 server/533 client、Task4 最终 275 client/148 server、插件 1418 tests，以及集成 Chrome 15/15、Task7 118 focused + 2 route Chrome、版本契约 33/33。数字为已有回执，不是本 reviewer 重新执行。
- root 另已报告真实本地 API/Chrome owner/editor 绑定并刷新持久化、viewer 403、禁用 start/template 中文原因、42300 字 PageEditor 显式 Save/API 逐字回读/刷新通过。原生隔离 Obsidian Vault 手动连接、自动三级目录及首次 V2 Sync 通过属于最新验收回执；cleanup 状态由 root 核实。
- 当前完整 `pnpm test` 旧版本断言首轮失败保留；167237a1 修正后完整 test/build 尚在运行。root 已报告全 typecheck/lint 通过，最终完整输出仍需关联最终 SHA。没有将单文件 GREEN 当全量通过。
- 原 Space“黄金书屋”403、原生拼音 IME、Windows、真实 provider、原测试者第一次 Obsidian 配对/同步失败仍待验。Chrome mock 布局/图谱/协作证据和真实本地 API 证据分开。未做生产恢复、发布或部署。

## Assessment

**源码与跨任务审查：Approved with one Minor。Spec alignment：主体符合，M1 为明确的小型双语偏差。**

**Ready to merge? With fixes / gates pending。** 没有 C/I 代码阻塞；root 已选择修 M1，应将插件新 SHA 和限定复核追加本报告。实际合并前仍须 final SHA 的完整 test/build 成功、验收文档完成并如实保留未验项。该结论仅对本地候选，不授权或证明已 merge/deploy。
