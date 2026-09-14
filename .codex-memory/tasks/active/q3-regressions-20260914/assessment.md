# AgentWikiQ 3 修复评估

结论：需要修复，但不能把全部测试预期直接当成修复规格。20 项均已审阅；优先处理人工内容覆盖风险、重置密码登录、回滚及 Obsidian 同步阻断。

评估依据：原报告、其中三张同步错误截图、当前主仓 HEAD `166383e3`（v0.11.2 后验收文档提交）、独立 AgentWiki-Obsidian 工作区源码（manifest 0.5.0）。本次为静态代码核对，未修改产品代码、未操作生产数据、未执行真人账号或 Windows 原生复现，未验证测试者实际安装版本。代码可解释现象，不等于每一条已完成端到端复现。

报告首页整理日期仍为 8 月 31 日，但包含 9 月 10—11 日新证据，不能整体当成旧报告关闭。下文“旧”沿用原编号，“新”沿用新问题 1—8。

## 逐项决定

| 编号 | 是否需要修 / 优先级 | 核对结果与处理边界 |
| --- | --- | --- |
| 旧 权限-001：重置密码后退出 | 需要，P1 | 已找到完整代码链：强制改密页包含 Navbar，Navbar 请求 `/review/count`，mustChangePassword 被服务端以 401 拒绝，全局拦截器清除登录。应让强制改密流程正常完成，保留旧会话失效机制。 |
| 旧 接入-002：接入说明不一致 | 需要，P2 | 指南仍使用静态 `step4-generated-credential.png`。应更新步骤、截图并统一入口用语；是否保留多个入口不构成缺陷本身。当前截图与接入页逐屏验收待做。 |
| 旧 接入-003：GitHub 地址无法识别 | 必须排查，P1 | 报告其实显示来源已建立、1 次运行 failed、0 个版本；不能据此定性为 URL 无法识别。当前源码存在 Git clone 获取链路。需取得该次运行的阶段、错误码和日志，区分抓取、网络、解析、编译失败，并提供可操作提示。 |
| 旧 协作-004：协作中英文混杂 | 需要，P2 | 系统模板 `world-bible` 节点名称双语、objective 固定英文。补齐系统模板展示文案本地化；用户内容、技术 ID 不应被自动翻译。新模板版本与历史运行快照分开处理。 |
| 旧 提示-005：复制提示不消失 | 需要，P2 | 通用 Toast 没有自动关闭机制。成功提示应短暂展示；失败、需要用户行动的提示单独决定停留规则，不能全部定时抹掉。 |
| 旧 国际化-007：权限错误英文 | 需要，P2 | 复现实际是成员被移除后访问页面。PagePreview 直接渲染服务端 message。应按错误码本地化；权限拒绝本身正确，不应为了“修复”而放行。 |
| 旧 图谱-08：无法缩放拖拽 | 需要，P2 | canvas 只有点击/双击，没有缩放、平移、节点拖拽处理。属于交互能力缺失；建议连同适应视图和重置视图处理，复测大图边界。 |
| 旧 国际化-0009：Agent 角色英文 | 需要，P2 | SpaceMembers 的 Reader/Editor/Publisher 文案固定英文。中文界面使用角色译名，底层权限枚举保持。 |
| 旧 成员-010：授权五空间只见一个 | 必须排查，P1 | MCP list_spaces 调用基于当前 principal 和 spaces:read 的授权查询；截图仅证明 Agent 有五个 Grant，不能证明 OpenCode 使用相同 Agent/凭证且 scope 足够。核对身份、凭证绑定、scope 与实际工具原始返回，再决定修权限查询、客户端接入还是提示。 |
| 旧 版本-011：回滚失败 | 需要，P1 | 前端 action 只提交 comment，后端 revert 必需 expectedTreeRevision，契约不匹配。应补齐版本与冲突处理。Sync v3 变更集明确不支持 legacy revert，这一限制仍应保留。 |
| 旧 审核-012：重复内容可通过 | 调整预期，P2 产品改进 | “内容重复就必须禁止”不宜直接采用：相同正文可能有合法用途。建议同空间重复风险提示；相同身份重复提交的幂等问题应另测，不能与不同页面正文相同混为一谈。 |
| 旧 协作-013：角色 ID 逐字失焦 | 需要，P1 | 编辑行 key 使用 `${role.id}-${index}`；每次改 ID 都重建输入节点。输入参数 key 字段也有同类模式，一并检查。应采用编辑期间稳定的行标识。 |
| 新 1：标题无输入框 | 需要，P2 | 实际存在 input，但 border-none、bg-transparent、focus:outline-none，空白值使可编辑区域难以发现。应补充明确标签、空态提示和聚焦样式。 |
| 新 2：空白标题不可点击 | 需要，P1 | DTO 只校验标题最小长度，空格可通过；目录按钮直接渲染原始 title 且无最小高度。禁止新建/改为纯空白标题，历史异常页面展示“未命名页面”并保留完整可点击区域。无需静默批量改写历史页面。 |
| 新 3：Obsidian 其他空间拉取失败 | 需要排障修复，P1 | 截图是 Sync v3 首次同步，错误为“未知或未来的控制 payload 版本”。已定位插件控制存储校验处，但该分支也可能把格式或哈希校验失败称为版本错误；不能直接归因插件太旧。需保留对应映射的主/prev/next 控制文件，核对实际插件版本和 guard 拒绝原因。 |
| 新 4：冲突保留本地仍失败 | 需要排障修复，P1 | 截图明确 `V3_VAULT_VERIFY_FAILED`。当前代码在应用后重新扫描并核对目录、页面、附件及哈希，多种失败共用此码。需输出具体差异并复现 Windows 路径、附件引用和内容回读；禁止通过跳过验证来“修复”。 |
| 新 5：本地删除后同步失败 | 失败需排查，P1；预期需修订 | 截图是 Sync v2，显示本地删除 2 目录、5 页面，服务器仍为基线。双向同步中删除也是变更，“自动合并”不应无条件理解为恢复服务器。应明确恢复远端与同步删除的选择；实际无法完成的原因需执行错误/日志，本截图没有给出。 |
| 新 6：搜索漏文章、匹配度异常 | 需要，P1 | 搜索采用语义优先，只要返回一项即结束，不再合并标题/全文匹配；固定 >0.5 阈值可漏掉字面匹配。文字兜底又统一 similarity=1，前端显示为 100%。应合并检索结果并明确评分含义；A/C 的权限和索引仍需核对。 |
| 新 7：发布 Agent 内容覆盖人工修改 | 最高优先核查并封堵，P0 风险 | 发布 helper 的 expectedUpdatedAt/expectedContentHash 都是可选检查；使用发布瞬间读到的 updatedAt 做 CAS 只能防事务期间竞争，不能单独保护候选提交后的人改。部分正常入口已生成基线，故本次测试的确切入口及 payload 必须核对，不能声称所有入口都失效。要求旧候选发布时拒绝覆盖并提供重新生成/重审路径。 |
| 新 8：协作管理模板跳错 | 需要，P2 | CollaborationWorkspace 明确链接 `/settings/page-templates`。应让“管理协作模板”进入协作模板管理语境，页面模板入口另行明确命名。 |

## 关键代码证据

以下路径相对于主仓 `agentwiki/`，行号对应本次读取版本：

- 登录：`apps/client/src/App.tsx:88`、`components/Layout.tsx:14`、`components/Navbar.tsx:21`、`api/client.ts:22`；服务端 `apps/server/src/core/auth/combined-auth.guard.ts:87`。完整链路解释了为何连改密页面也会退出。
- 回滚：`apps/client/src/features/review/ReviewPage.tsx:172` 提交 comment；`apps/server/src/review/review.controller.ts:74` 传 dto.expectedTreeRevision；`review.service.ts:1611` 校验版本。
- 候选冲突：`apps/server/src/review/page-update-publication.ts:31` 可选基线检查、`:74` 发布时 CAS；`review.service.ts:80` propose 保存传入 payload。对照 `knowledge-pipeline/knowledge-submission.service.ts:195` 和 `source.service.ts:513`，部分生产者已填写 expectedUpdatedAt；需确认报告候选来自哪一条链路。
- 搜索：`apps/server/src/core/search/search.service.ts:105` 语义分支、`:134` 提前返回、文字结果固定 1.0；`apps/client/src/features/search/SearchResults.tsx:108` 把分数显示成百分比。
- 输入失焦：`apps/client/src/features/collaboration/TemplateEditor.tsx:193` 和 `:203`。
- 跳转错误：`apps/client/src/features/collaboration/CollaborationWorkspace.tsx:207`。
- 标题：`apps/server/src/core/dto/page.dto.ts:111`；`apps/client/src/features/page/PageEditor.tsx:1106`；`features/content-tree/ContentTree.tsx:260`。
- 本地化：`apps/client/src/features/space/SpaceMembers.tsx:47`、`features/page/PagePreview.tsx:342`；`apps/server/src/collaboration-workflows/template-definitions.ts:464`。
- Toast：`apps/client/src/components/Toast.tsx`。图谱：`apps/client/src/features/knowledge/KnowledgeGraph.tsx`。
- 独立插件仓：`/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/src/storage/envelope.ts:94`、`src/application/tree-local-apply-v3.ts:263`（以及 271/282/295）。截图不足以确定具体拒绝字段，不建议删除控制文件或基线试错。

## 修复顺序与验收要求

1. 优先验证新 7，确保候选提交→人工保存→审批发布不能覆盖人工新版本，并覆盖普通提案、知识提交、来源编译和协作产物。区分提交时基线与发布时 CAS。
2. 修复登录、回滚、角色编辑、空白标题、搜索等已定位缺陷。验收包含真实页面操作，不能仅测后端服务或静态渲染。
3. 独立处理插件三个场景，取得测试者实际版本和该映射的脱敏诊断证据，使用隔离 Vault 做 Windows 原生拉取、冲突保留本地、删除/恢复验收。插件发布与本地安装分别记录。
4. 修复提示、导航、本地化和图谱；GitHub 来源、多空间授权需真实运行错误和凭证身份核对后再定根因。重复检测作为提示能力，删除恢复作为明确操作语义设计。

当前没有把任何报告项标记为“已修复”。
