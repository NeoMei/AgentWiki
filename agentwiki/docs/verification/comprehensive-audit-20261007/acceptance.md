# 全面任务、代码与系统复审

2026-10-07。用户要求反复审查任务、代码及前后端/UI，修复值得修复的问题。审查基线 e0f2d12a，整分支向前覆盖165c207b；最终产品候选 `8104a239217d4f050ae56876e1895c420687d860`，最终浏览器测试候选 `304aa3660c88e0ab7a4cd03638999c834c0fa0ab`（之后仅修测试定位器，产品内容相同）。后续封存提交只含文档。结论：PASS（本轮范围内无已知值得修复的未关闭问题；不是对所有平台和所有潜在缺陷的零缺陷保证）。

## 已修复问题

| 编号 | 实际问题 | 修复和证据 |
| --- | --- | --- |
| F1 | 旧K1来源回执在K2后重放，metadata回退但head未回退 | d449dcf4，锁定Source并查receipt后才更新新metadata；实际API RED→GREEN、相关单测和独立复审 |
| F2 | Run/Source嵌套读取在独立FK不一致时展开外Space来源、版本、证据或ChangeSet | 409fa3b5，共同返回关联校验；隔离DB异常关联、REST RED→GREEN；合法安全summary保留 |
| F3 | Review读取/操作401、403、404后残留旧正文、证据与写权限 | 3fa75091，清缓存和请求epoch；mutation重新确认合法read权限；focus/mutation/action撤销及viewer降级五条实际UI路径GREEN |
| F4 | 全量测试未预检两项DB变量，失败输出被截断 | 3c201e51，补前置变量并等输出结束后抛错；2MiB慢reader RED→GREEN及独立24项 |
| F5 | 同步状态last-completed Run未核对Space和输入Version所属Source，经REST/MCP返回外来源文件metadata | 6d66bb05，查询和返回双校验，保留合法历史completed/partial；独立20项、实际旧构建8项RED→最终构建REST/server MCP8项GREEN |
| F6 | Human Admin具备实际创建权限，但模板目录遗漏admin并返回canCreate:false，界面退回旧模板流程 | 6dd46114，与共享授权统一owner/admin/editor能力投影；角色矩阵RED→GREEN、独立四套83项；最终实际UI通过（R8 Admin复合创建、sourceTemplateId/version/locale/body均核验） |
| F7 | 模板预览首次标题焦点缺失；返回重选时旧请求可阻塞或污染新预览 | 8104a239，首次ready的一次性焦点意图、主动移焦后不抢焦点，返回列表取消并失效旧请求；独立复审及最终移动端实际UI通过 |

F2/F5通过自有隔离数据库构造异常独立FK，不声称正常公开写入可制造此状态。F2列表未返回Evidence时可保留仅Evidence损坏的授权Run摘要，但不得包含外来源信息；F5选择最后合法完成输入，不改成current head。F6没有扩张Agent或非成员平台管理员权限。

旧agent-write测试mock、过时的创建路由/定位器、cross-client旧memory fixture另外修正。模板R7曾被初步误判为单纯测试合同，核查共享授权后识别为F6并修复产品；错误的canCreate:false测试补丁未提交。原始失败记录全部保留，没有削弱权限、限流、业务断言或增加skip。

## 多轮审查

首轮独立任务/后端/前端gateway审查 → 各修复独立复审 → 整分支R2 → 文档前端与竞争探针复核 → R3发现F5 → F5修复复审及相邻读取R4 → 实际UI R7发现F6 → F6独立83项与相邻授权复核 → R8发现F7 → F7独立焦点/竞态复核 → 最终任务签收。最后范围内无未关闭的已知值得修复问题；不是对全部软件或所有平台零缺陷的保证。独立最终结论见 `final-task-review-r6.md`。

## 回归结果

| 阶段 | 最后有效结果 | 原始记录 |
| --- | --- | --- |
| runtime非DB | 305 pass / 1 opt-in skip | full-regression-r3.log |
| runtime DB | 230 pass / 0 skip | 同R3 |
| server，含F5/F6 | 2994 pass / 4 skip | server-regression-r6.log/json，候选6dd46114 |
| server连接授权门禁补跑 | 3 pass / 0 skip，补齐上述三个skip | connection-ux-jest.log及独占DB/Redis清理回执 |
| client，含F7 | 2170 pass | client-regression-r7.log/json |
| sync-protocol | 140 pass | 同R4 |
| local-sync | 985 pass / 1 Windows skip | 同R4 |
| typecheck / build / lint | 全部exit0，最终候选 | final-build-r7.json与对应日志 |
| Chrome浏览器 | 31/31 PASS、0 FAIL、0 SKIP、0 flaky；最终模板R11为10/10 | broader-built-e2e-report.md、各批results.json |
| 追加系统脚本 | 4/4通过 | built-e2e-extension-r2/r3；明细见下 |
| Q2 fixture UI | 4/4通过 | q2-fixture-ui-acceptance.md |

核心各阶段去重6827项成功，不把重复定向测试或浏览器数字再加进去。结果由分阶段组合，不能写成单次pnpm test:full exit0。R1缺env、R2专用库名拒绝、R3旧mock失败保留；修复后重跑受影响阶段。F5/F6后重跑后端全套，F7后重跑前端全套；最终候选重新构建并完成受影响浏览器流程。

净剩三个未执行用例：独立安装CodeGraph标准扫描opt-in、Windows bundled OpenCode可执行启动、Windows ACL。没有自动安装scanner或冒充Windows结果。lint为0 error、3项原有未使用变量warning；构建通过既有体积门禁，但仍有大chunk提示。本轮未新增迁移。

## 实际交互范围

- 来源审批、发布、回滚、拒绝；过期候选409 SOURCE_VERSION_CONFLICT与重生成指引，正式正文不变；1280/390实际built UI。
- 非空图谱REST与server Streamable HTTP MCP共25checks：自有PAT撤sources读取后，来源和证据字段消失，独立授权的page/nodes/正文保留。不是gateway stdio resources/read证明或scope管理UI。
- 长文18章、36子标题、12列宽表，1280/1600/390实际Chrome：目录定位、Agent输入和发送、面板开关、表内横向滚动、无整页溢出。截图人工检查通过。
- 文档真实built UI、API、worker及确定性provider进程：真实鼠标选文、两笔批注和显式引用，Send前零assist POST；两轮候选与人工键盘输入交错、逐项接受、Undo/Redo；Save前HTTP正式正文逐字不变，Save后等于独立预期；跨文档历史、刷新和连续追问；冲突保留人工文本；started后实际Stop且无completed。
- 自有参考页归档后：session detail返回合同400、list隐藏会话，重新加载UI不显示旧历史，其余合法正文保留。错误path回显请求自身sessionID不算新来源泄露，referenceID和旧quote仍不得出现。两次过严操作期待失败及独立复审保留。阅读态选文证明覆盖普通可映射段落，复杂选区回退仅验原文入口可用，不宣称任意富文本选区都可映射。
- 广泛浏览器覆盖Markdown富渲染、附件、语言、公开引导、Socket协作、一次性device授权、Local Sync onboarding、目录与模板版本/权限/中英文/空白创建/取消操作。最终模板R11使用8104a239产品构建与304aa366测试候选，前端完整2170项通过；Local Sync 1/1在6dd46114构建通过。collaboration-reentry-layout明确为mock API布局用例，模板分页错误注入等按测试源码保留fixture身份，不将31例全部冒称真实后端覆盖。
- 追加脚本：ui-route-smoke为5 public / 15 authenticated / 7 mobile routes；smoke-test为32checks；Agent成员desktop/mobile；cross-machine-e2e为同主机多个真实SyncEngine与独立client homes，1 conflict、1 relation、2 approved deletions、memory0，不冒充物理跨机或新的revoke测试。
- Q2任务看板/图谱图片4/4为source-dev + API/image mock的真实Chrome，独立清理且source/dist/state未变；不作为built后端证明。

新建页采用独立route，旧modal Escape/opener焦点合同替换为Cancel确认、返回目的地、无创建副作用与当前焦点/视口验证。单页模板编辑标题后失焦刷新预览，复合实例化显式结果页“打开页面”。附件direct-anchor用独立文档加载；另有独立probe确认native hash warning不丢草稿且离开guard正常，保留该warning，未改生产路由或隐藏错误。

## 环境清理与交付边界

最终8104a239运行时进程、API/web端口、Agent IPC、独立schema和临时目录均已核验清理；`final-green-r7-external-cleanup.json`记录PID/端口/schema/路径均为清零。两个专用PostgreSQL测试库在无活动连接时删除，`owned-databases-cleanup.json`记录数据库不存在且共享PostgreSQL未停止。R11浏览器进程和其独立fixture已退出/清理；保留脱敏证据和私有原始trace。

真实模型实验仍保持原冻结八题：A事实7/8、B8/8，严格引用各7/8，收益NOT MET；已按预批准fallback撤回额外指导，本轮未追分或改评分。原实验是真实provider+合成知识，本轮文档生成是fixture。ACP仍接口定义，CodeWiki排除；未push、merge、发布、部署、生产迁移或升级日常客户端。

原始证据根 `/tmp/agentwiki-comprehensive-audit-20261007`（0700）。私有trace/state不入repo；脱敏审查摘要和不含凭据的SHA-256文件索引随本报告保存。旧draft保留当时身份，不作为最终通过回执。
