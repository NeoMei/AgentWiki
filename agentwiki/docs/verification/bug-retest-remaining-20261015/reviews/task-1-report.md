# Task 1 实现报告：模板来源与协作 #5 #6 #16 #17

## 状态

本地候选已实现，定向回归通过。未操作 UI 浏览器、未部署、未暂存/提交。原 billy 账号浏览器与生产旧记录尚待主任务回验，不能据隔离测试判定原 #6 已关闭。

先读 task-1-brief.md、constraints.md、原 report #5 #6 #16 #17；按 systematic-debugging 先定位根因并运行失败回归。CodeGraph 目录存在但 CLI `codegraph explore` 返回无索引，未重新索引；随后改用文件定位。

## #5 来源页面搜索反馈

根因：来源查询已向 API 传 q 并正确筛选/分页，但结果只生成 select option，默认选中“源页面”，没有任何可見数量或结果列表。

改动：在现有 select 下直接显示匹配总数（aria-live）、有界可滚动结果按钮（每页最多100条），点击选择精确页面 ID，aria-pressed 显示当前选择；选中后明确显示名称、路径/目录/ID兜底和更新时间日期；无结果时显示“未找到匹配页面”。保留 select 的键盘路径和 source updatedAt/OCC 校验；加载中隐藏旧结果、防止选错响应，失败保留原选择供重试。没有自动选择单结果（原建议允许，但未强制），避免无意识提交。

验证：新增双同名页/不同路径场景，数量2可见、点击指定路径选择ID b、选中日期可见、后续无匹配时提示且提交禁用。原分页、100条上限、关键词并发过期响应、失败保留、重试、模板冲突和空间切换回归全通过。

## #6 旧小说运行卡住与无法重启

根因：旧浏览器 localStorage 指针键仅使用 space/template，未区分登录用户；initialize 自动加载该指针，draft/ready恢复步骤，其他状态一律 setStarted。StartedStep 从此隐藏输入和导航，没有新运行入口，而且标题仅表示“协作已启动”未显示真实运行状态。恢复失败 catch 原先直接删除指针，可能误删暂时网络/权限失败的可恢复草稿。

改动：新指针按 userId 隔离；旧指针仍可恢复，在服务端字段 startedById 已知时仅迁移原启动者记录，并确认模板匹配；draft/ready 的恢复、Agent可执行状态校验、版本/OCC和冲突流程保留。任何保存运行/已启动结果/恢复失败都提供“开始新运行”，仅脱离本地指针并清空当前向导，旧服务端运行、草稿、审计历史保留在进行中/历史。为每次新运行刷新幂等键并递增 mutation/request epoch，拒绝旧异步回执。已启动结果明确显示服务端当前状态。恢复失败保留指针，提供重试或显式新运行，禁用静默覆盖草稿的提交。

验证：旧 shared key 中 running/completed/cancelled 均能显示真实状态并开始独立新草稿、不更新/启动旧记录；另测 scoped 其他账号不读取、legacy其他starter不采用、已有draft显式新建保留旧server记录、网络失败保留指针并禁用提交、连续启动两次幂等键不同。针对原报告 Golden Book space/template ID，加载真正 novel-writing seed（多role self-review），恢复“龟兔赛跑” running DTO与shared legacy pointer，再以中文入口开始“新故事”、提交 story-premise，验证仅 createRunDraft调用、不修改旧故事。已有ready/draft输入恢复、Agent权限收敛、异步失权、冲突重试和路由隔离回归通过。

限制：本代理没有访问原 billy 账号、原 localStorage或原运行数据库，测试是同结构数据模拟而非生产原场景回放；需主任务用原启动 URL 回验、确认服务端显示真实状态及入口可用。旧字段缺 startedById 的历史响应按兼容策略保留恢复（现服务端投影包含该字段）。创建新运行不自动取消旧运行，原运行状态由现有服务端生命周期管理。

## #16 历史/进行中时间顺序

根因：后端已 `createdAt DESC, id DESC` 稳定排序并使用 createdAt/id signed keyset cursor；UI 列表展示 updatedAt，导致展示日期相对排序字段不连续。无需改变后端游标、数据库schema或历史签名。

改动：两类列表统一保持创建时间倒序，显示创建时间，顶部明确“按创建时间倒序 · 显示时间：创建时间”。同创建时间保留后端id降序的稳定并列规则。缺createdAt仅显示“—”，不以更新时间伪装创建时间（真实API已有createdAt）。符合原建议“按创建或完成时间统一排序”，避免改变游标语义。

验证：active/history 各测试新创建时间早更新时间逆序的三个记录，同时间id b/a稳定；断言DOM顺序和time datetime准确对应createdAt。原服务端run.service及history-cursor 74项通过，包括100条分页、DB过滤、createdAt/id下一页边界与跨空间/状态签名验证。

## #17 运行名称必填提示

根因：validatedInputs遇空runName直接return null；InputStep没有required/标识/错误反馈，按钮无form原生校验。

改动：运行名称加星号与required；空白/空字符串显示本地化行内alert、aria-invalid与aria-describedby并聚焦名称输入。编辑名称清除错误，恢复/开始新运行重置错误。

验证：故事/工作输入已填而名称空时下一页保留步骤，required、行内提示和focus均正确，API不被调用；输入名称错误消失。原三步骤流程与数字必填校验保持。

## 改动文件（本组）

- apps/client/src/features/collaboration/RunStartWizard.tsx
- apps/client/src/features/collaboration/RunStartWizard.test.tsx
- apps/client/src/features/collaboration/CollaborationWorkspace.tsx
- apps/client/src/features/collaboration/CollaborationWorkspace.test.tsx
- apps/client/src/features/collaboration/components/RunList.tsx
- apps/client/src/features/page-templates/PageTemplateManager.tsx
- apps/client/src/features/page-templates/PageTemplateManager.spec.tsx
- apps/client/src/i18n/bug-collaboration-messages.ts（主任务已整合messages.ts，本组未改共享messages）

## 验证收据

- 修改前：新增6项用户可见回归均失败（名称required/旧running-completed-cancelled重启/恢复失败保存/来源可见结果），既有111项通过。
- 修改后：client vitest `RunStartWizard.test.tsx PageTemplateManager.spec.tsx CollaborationWorkspace.test.tsx RunDashboard.test.tsx PageTemplateManager.composite.spec.tsx`：5文件225/225通过。
- server Jest `run.service.spec.ts history-cursor.service.spec.ts`：2 suites 74/74通过。
- 本组8文件eslint：exit0。
- 全树git diff --check：exit0。
- client `tsc --noEmit` 最终exit0；早期全树检查受并行组临时缺文件/SpaceView test timeout类型错误影响，已回报并在其修复落盘后重验通过。

保留v0.12.30 #2系统单页面中文映射、#3居中审核弹窗、#4模板库管理职责；RunDashboard/管理页相关回归均通过。未改变权限、审核策略、预算/分页上限或skip门禁。


## 独立审查后修复（基线 d05a8323）

本轮只修改 RunStartWizard.tsx / RunStartWizard.test.tsx，并更新本报告；不提交。

1. 真实双请求身份字段丢失：HUMAN_RUN_SELECT带startedById/templateId但不带inputs；getHumanRunDraftDetails带inputs却不带这两个身份字段。原loadEditableRun直接返回details整份替换summary，导致真实draft/ready恢复的legacy账号与模板检查被绕过。本轮合并summary和details，明确保留summary的不可变startedById/templateId/spaceId，动态status/version/name/inputs/bindings采用最新details。新增draft/ready × 其他starter/其他template共4项真实投影回归，修复前4项失败、修复后通过；同账号合法恢复额外验证legacy迁移、inputs恢复及更新expectedVersion使用details版本3而非summary版本2。
2. 不当删除未采用legacy指针：当前账号scoped草稿与另一账号legacy草稿可能共存，原beginNewRun无条件删除两键。本轮仅删除当前账号scoped键，未采用legacy保留。通过页面级restoreLegacyPointer guard让显式新运行在语言切换重新initialize时不再自动采用该未知legacy（账号/route切换重置guard）；成功采用legacy时原有迁移会已删除确证的指针。新增共存场景回归修复前发现foreign-legacy变null，修复后保留，并验证切语言没有额外getRun/旧指针恢复。
3. 恢复重试误解锁：首次getRun失败后restoreFailed=true，原initialize开头无条件清false；后续getTemplate/listMembers失败留下已有template，Next重新可用。本轮保持restoreFailed跨整个重试，仅成功取得savedRun或确定已无待恢复pointer时清除；显式beginNewRun仍可解锁。两项回归覆盖首次run读取失败、第二次template/members分别失败，修复前找不到Retry saved run且Next解除阻断；修复后按钮与disabled持续、指针保留、create不调用，第三次成功恢复到saved draft正确释放阻断。

新鲜验证：5文件232/232客户端回归通过（原225+新增7，且强化原合法draft恢复用例）；RunStartWizard两文件eslint、client tsc --noEmit、全树diff --check均exit0。此前74项服务端查询/游标回归未改相关代码，不重复运行。生产/原billy浏览器回验限制保持。


## 首屏 bundle 门禁收尾（基线 320906ef）

主任务授权仅移除 shared messages.ts 的 bugCollaboration import/en spread/zh-CN spread。新双语文案现移到三个feature-local模块：collaboration/runStartText.ts、collaboration/runOrderText.ts、page-templates/sourceSelectionText.ts。各feature用稳定useCallback翻译wrapper先查局部文案，再回退原sharedT；保持全部新反馈、中英文、参数替换和原系统模板翻译，RunStartWizard子组件继续接收同一t。i18n/bug-collaboration-messages.ts作为局部translator导出入口，未被shared messages引用；无首屏文案漏失或预算调整。

验证：客户端原5文件232/232通过；本轮8文件eslint exit0；build中tsc通过，Rollup预算仍失败：551966降至550117/550000（超117 bytes）。单共享局部字典版是550177，进一步拆功能局部模块减少预加载开销60 bytes。预算未改、文案未删除。剩余117 bytes已通知主任务，由其负责其他shell减重后重跑门禁；本组不扩展越权修改。构建日志 /tmp/agentwiki-collaboration-clientbuild.log。新增局部模块尚未提交。
