# E2E旧合同修正独立复审 R2

**结论：Approved。补丁没有因为失败而放宽业务断言；未发现值得修复的问题。实际built重跑仍待root执行，不能由本次审查代替。**

不可变补丁：`e2e-contract-refresh-r1.patch`；实测SHA-256 `a5a683334d5983e2436f4195242b967bdf2886e86af4877c601182932bfb787e`，与派发一致。核对四个变更文件、当前产品实现、首轮JSON结果、失败error-context，以及collaboration-reentry原trace.zip里的实际network记录。没有改代码、build、启动服务或浏览器。

## 逐项判断

| 修改 | 独立依据 | 判断 |
|---|---|---|
| collaboration安装版本从0.7.0改读取当前package | `packages/local-sync/package.json`当前name=@neomei/agentwiki-local-sync、version=0.11.0；server `core/dto/local-sync.dto.ts:24`继续IsIn支持版本；首轮真实400列出支持0.9.0至0.11.0，不含0.7.0 | 合理消除过期fixture输入。相对URL从e2e文件向上三级准确到agentwiki/packages。仍经真实安装API，未mock/绕过版本检查，也未删协作/Socket业务验证 |
| collaboration-reentry补mock users/me与review/count | 首轮trace实际GET `/api/review/count`返回401，随后导航到根页面导致找不到continuation按钮；`Navbar.tsx:27-28`确实请求并读取`response.data.pending`。补丁返回pending=6吻合该合同 | 该测试原来就是模拟身份/Space/Run的layout fixture，补全导航请求不是把真实授权改mock。顶部明确fixture-only。users/me是预防合成token误进真实profile请求；旧trace中实际401仅证明review/count，不将users/me写成已观察失败。原桌面/390布局、scroll与continuation按钮断言保留 |
| editor-language从aria-pressed改动态action label | `PageEditor.tsx:1244-1253`是普通button，label及可见span随mode改Preview/Return to edit，没有aria-pressed；原error-context明确收到null。产品已有单surface模式切换 | 不需要强加pressed语义。新测试仍实际点击，并新增预览模式contenteditable=0、渲染heading可见、编辑恢复contenteditable=1、刷新回编辑且zh-CN持久化检查。比旧属性断言更直接且更强。consoleErrors为空仍保留，未吞错误 |
| onboarding-guide改当前标题/展开全文/JSON命令/复制 | `OnboardPage.tsx:40-57`现有标题、details summary、role=status与常驻复制按钮吻合；`onboardPrompt.ts:10-16`当前协议是JSON start/status/continue/reply-file；config/localSync.ts与package版本均0.11.0；旧页面快照也显示0.11.0及“连接你的 Agent” | 新增clipboard逐字等于显示全文，且独立核对当前package/version、当前origin/api、codex/json、实际读页验证要求和continue reply-file命令，避免仅与同一错误文本自比较。复制状态与语言/URL重定向断言保留；不把旧ndjson或整段prompt必须以协议参数结尾当现行合同 |

## 没有放宽的边界

- 没有删除测试、加skip、缩小选择集、延长产品超时掩盖失败、提高重试或修改限流。
- 没有将安装/协作实际API换成fixture；新增route.fulfill只在已经明确fixture-only的布局测试中。
- package版本动态读取不会自行让未支持的新版本通过：后端IsIn仍会拒绝；onboarding版本若与构建内LOCAL_SYNC_VERSION漂移仍会断言失败。
- 首轮其他429与editor mobile失败没有被本补丁宣称修好。root分分钟分批运行、保留原限流，是运行安排变化；必须保留首轮失败证据并记录后续真实结果。

本次是测试合同/断言强度审查，非四个场景已通过的运行回执。下一步在原同一冻结实际前端构建上执行这些更新的测试；报告要继续区分真实协作API、普通built UI和数据fixture layout。
