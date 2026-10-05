# Whole-branch independent review

审查日期：2026-10-06。只读审查；仅本报告写入，不修改实现、索引、HEAD 或 Git 配置，不派生代理，不重复全套测试。

- Base: `c7b89567e50c3749a87b70034357c7e9de226f81`
- Head: `897aa3f8af3f61a52bd5a6681f43cbdf32e88430`
- 范围：23 commits，231 个变更文件；大量文件为独立 Tiptap 探针的输入、输出、AST 与差异证据。审查主线是所有产品变更与跨任务边界，探针审查脚本、汇总及反例，不逐字人工复核每份生成 AST。
- 依据：批准的 `docs/superpowers/plans/2026-10-06-document-workspace.md`、借鉴分析与改造建议、SDD progress ledger、各任务独立 review/rereview，以及最终现有验证日志。遵循 `requesting-code-review/code-reviewer.md` 模板。

### Strengths

1. **候选、正文及发布职责清楚。** `AgentAssistPanel.tsx:280-291,334-352,361-401` 将 stream/done 留在候选状态，只有显式接受调用父级；`PageEditor.tsx:825-845` 再核对当前 user/Space/page、权限、保存状态、远端版本/冲突及接受账本，并以当前 EditorView 原文重新计算。`MarkdownWorkspace.tsx:684-693` 使用隔离的 history transaction；候选进入本机草稿复用正常 onChange，未加入第二个保存或发布通道。

2. **精确修改保持源文本、并保守拒绝不确定定位。** `assistTargets.ts:34-103` 核对全文外侧字节、唯一上下文锚点和前序已接受变更；保留分隔符的有界行差异不会通过重新序列化 Markdown 改写无关正文。`assistCandidate.ts:32-79` 保留版本/身份门，逐项接受重新定位，已接受项不能重放。空内容、无变化及越界结果不作为可接受正文。

3. **草稿恢复与远端更新边界有效。** `localDrafts.ts` 的 user/Space/page 编码 key、schema 校验、exact-version 删除，以及 `useLocalDraft.ts:16-99` 的 human 来源、debounce/flush 与保存期间后续输入保护相互吻合。`PageEditor.tsx:321-364,958-968,1197-1203` 在撤权时取消本机写入/offer，并保留已知 socket 冲突；旧远端基线只可查看/导出。已关闭的 discard-new-pending 和 socket-revision 回退问题未被后续集成重新引入。

4. **服务端授权不只在请求入口检查。** `assist.queue.ts:153-180,205-236` 在执行及完成前验证请求者、Space/page、lease 和目标版本；完成时按既有 User→Space 锁顺序重读并持锁写 done。核对了 `AuthorizationService.lockLiveHumanPrincipal/assertLiveHumanSpaceAccess` 及既有 Space/Page 写路径，未发现此次变更颠倒锁顺序。`assist.controller.ts:42-82` 与 service 读取按请求者过滤；`collaboration.gateway.ts:536-579` 从 canonical task 取得所有者、逐次检查 live socket 权限，并按任务串行发事件，未向整个页面房间广播私人快照/生成内容。

5. **跨任务状态衔接完整。** `PageEditor.tsx:601-639,1262-1286` 在同一身份内隐藏而不销毁 Assist controller，切换身份/页面则重置；`usePersonalNotes.ts:77-103` 的绑定、coverage 与 uncertain 集合将“发送/等待审阅/已解决”分开，只有被明确覆盖且接受的笔记可自动解决。`reviewComments.ts:42-58` 保留失败/丢弃/重开与 taskId 约束。本次没有把部分变化覆盖或模型完成误判为批注全部解决。

6. **目录、手工编辑和提案差异与既有约束兼容。** 目录新写操作保留 `expectedUpdatedAt/treeRevision` 并检查 route generation；偏好与加载结果按 user/Space 隔离，过滤明确限于已加载项且禁用重排。格式/链接/上传共用原编辑器交易，链接请求有授权范围、取消和失效门。提案界面只在版本相同时标记与基准一致，否则清楚显示 current-vs-candidate；审批 API 未放宽。Tiptap 探针失败后仍保留 CodeMirror，没有将有损全篇序列化接入产品，也没有新增 schema、CRDT 或部署路径。

### Issues

#### Critical (Must Fix)

无新增、有证据支持的 Critical finding。

#### Important (Should Fix)

无新增、有证据支持的 Important finding。此前 Task 1–5 独立审查中的阻塞项已有对应修复与复审；抽查最终源码未发现这些修复被集成覆盖。

#### Minor (Nice to Have)

无新增产品 finding。下面列出的验收范围和证据收尾是报告边界，不把未复现风险当作缺陷。

### Plan alignment

| 计划 | 整体判断 |
| --- | --- |
| Task 1 候选审阅 | 符合：无 stream/done 自动写入，显式接受/丢弃、实时校验、独立 undo |
| Task 2 目录体验 | 符合：文字/键盘菜单、行内写入、220–420 宽度与偏好、诚实的局部过滤、定位 |
| Task 3 文档画布 | 符合：读写互斥、共享视觉与 AST 大纲、格式/slash/page picker；浏览器视觉结果按 controller 证据计 |
| Task 4 本机草稿 | 符合：显式恢复、版本冲突保护、隔离与 exact 清理，无隐式发布 |
| Task 5 精确协作 | 符合：选区/章节/全文、逐项候选、私人批注及真实 proposal diff；私人本机存储是 ledger 明确裁定 |
| Task 6 探针与集成 | 符合：探针不足以替换引擎的结论有真实反例；最终整分支代码审查完成，最终构建产物浏览器/清理记录由 controller 单列 |

### Final bundle repair

重点独立审查 `897aa3f8`：`apps/client/vite.config.ts:40-44` 只将 `@codemirror/language` 和 `@lezer/common|highlight|lr` 纳入现有 `editor-core`，保留 `onlyExplicitManualChunks: true`，未纳入 language grammars/全部 modes；`build/bundleBudget.ts` 未被修改。

读取最终 `/tmp/document-workspace-build.log`，预算插件实际通过：首屏 `547266/550000` 字节，保留 1 个既有完整 Mermaid parser 例外，普通 chunk 限额仍为 500000。另核对当前发射文件：`PageEditor-s1I3DlGr.js` **423330** 字节、`editor-core-7MhzyKWc.js` **336673** 字节。此前 repair receipt 的 PageEditor 423120 是较早构建值，最终归档应使用最终产物值。未发现放宽预算、把 CodeMirror 提前到首屏、错误切入 grammar 或引入循环依赖的新证据；是否真实执行生产 chunk 属浏览器验收，不由 build 成功代替。

### Validation and limitations

**独立读取的已有证据（未重跑）：**

- `/tmp/document-workspace-client-full.log`：131 suites / 1844 passed。
- `/tmp/document-workspace-server-full.log`：161 suites passed、1 suite skipped；2838 passed、4 skipped。负例授权/版本异常日志与通过结果并存，不误记成运行故障。
- `/tmp/document-workspace-protocol.log`：140 passed；`/tmp/document-workspace-local-sync.log`：942 passed / 1 skipped。
- `/tmp/document-workspace-typecheck.log`、`-lint.log`、`-build.log`：全仓 typecheck/build 完成；lint 0 errors、3 个未修改服务端文件的既有 unused warnings。
- `/tmp/document-workspace-bundle-repair-tests.log`：预算测试 6 passed。
- Runtime 479 passed / 1 外部 CodeGraph skip、专用 DB/Redis 清理，以及真实本地浏览器 selected/batch/undo 等行为，采用 controller/任务报告的独立证据；本 reviewer 没有重跑 runtime、操纵浏览器或连接生产。

**本次额外只读检查：**显式 `--work-tree` 的 frozen range/HEAD 确认及 diff 阅读；产品 `apps`/lockfile 的 `git diff --check` 通过。全范围 diff-check 的非零结果仅来自 probe 保真材料的 CRLF、diff 上下文空行和输入/输出尾空行，应保留，不为“清零空白警告”改写证据。

**保留边界：**

- 原生中文 IME、Windows、真实多人压力、实际外部 provider 不在本审查独立实测范围。检查了 CodeMirror composition 事件过滤位置，不能仅凭 guard 返回值断言原生输入已坏；也不把 synthetic composition 测试当原生 IME 验收。
- 服务端竞态修复有源码锁路径和 deterministic fake-mutex 回归支撑；不是本 reviewer 新做的 live PostgreSQL 竞态实验。
- 本机笔记持久化，候选/任务绑定仍是当前编辑会话状态。刷新/切页后历史任务结果不可直接重放为当前候选；笔记可通过显式重开重新派发。该保守边界避免自动恢复后绕过实时原文/版本检查。
- Tiptap 的 17 语料是脚本/模型与现有 remark AST 比较，不是产品视觉编辑、原生 IME 或附件同步验收。1/17 字节完全保持、13/17 归一语义等价支持“暂不替换”，不支持宣称可视编辑产品已交付。
- 审查结束时 controller 正在写入验收报告、screenshots 与项目交接文档，均不在冻结产品 SHA 内；本 verdict 不宣称那些后续文档已纳入此 frozen range，也不授权发布或部署。

### Recommendations

- 将最终 build 的精确 chunk 字节数及构建产物浏览器结果收敛到最终 acceptance receipt；保留 fixture provider、平台/IME 和压力测试边界。
- 保留现有候选/本机草稿/远端保存三类状态及已覆盖的竞争回归；后续如增加跨设备笔记或刷新后继续接受候选，应另行设计身份、版本和接受账本持久化。

### Assessment

**Ready to merge? Yes.**

**Reasoning:** 冻结范围内产品实现与批准计划及明确裁定一致，关键身份/权限/版本、源文本和显式接受边界由客户端与服务端共同保护；最终分块修复未削弱检查，已有相关回归与全仓质量检查通过。未发现需要新修复轮次的有证据产品缺陷；此结论是代码合并就绪，不等同于生产发布、部署或未覆盖环境验收。
