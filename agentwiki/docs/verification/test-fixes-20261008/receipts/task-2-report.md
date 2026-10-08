# Task 2 回执：Markdown 编辑稳定性与 Agent 会话跟随

状态：实现完成，已冻结候选，等待控制器独立审查与主分支集成。原报告路径/真实 macOS 中文输入法/生产部署不在本回执的已验范围。

- BASE: `022f5b95131ac45b08425d3f8d3a8aaa1cd50196`
- Candidate: `c8d07982a8e234166836b068998f7bd9c547539a`
- Branch: `codex/test-fixes-editor-20261008`
- Worktree: `/Users/neomei/.codex/worktrees/test-fixes-editor-20261008/AgentWiki `（末尾空格）
- 改动限定 7 文件：MarkdownWorkspace 与 spec、AgentSessionPanel 与 spec、本地 e2e spec 及 html/tsx fixture。没有改目录、Space、i18n、服务端、保存路径或 provider。

## 实现与自审

Markdown language / highlighting / basicSetup / 无 pages 默认数组使用稳定引用；编辑器 onChange/onUpdate 用稳定回调转发当前 props，扩展数组与隐藏标记插件只随真实运行数据变化重建。隐藏标记仅在文档变化、活动行集合变化或语法树身份变化时重算，保留长文后台解析推进的更新。resolver/pages/occurrences 未冻结，scope 变化仍清空旧资源；输入导致真实 occurrences 改变时仍允许 reconfigure，静态 Language 的身份及解析缓存保持。

AgentSessionPanel 使用真实 turns 滚动容器与内容包装层；初入/切换会话定位到底部，用户在底部 80px 内的新回复继续跟随，本人成功发送强制跟随。上翻历史不会被轮询或延迟内容扩张抢滚动。ResizeObserver 观察内容和 viewport，rAF 合并尺寸变化；卸载/状态切换时清 observer 与 frame。成功发送的跟随状态按 mount/session 身份限制，避免旧请求干扰新会话。

自审核对：互斥编辑/预览不变，Markdown 渲染未禁用；replaceDocument 的 addToHistory + isolateHistory、上传锚点、onChange 最新回调、selection 恢复保留；PageEditor 显式保存与候选→草稿→保存未改；组成态 Enter/229/slash 守卫未改。稳定全局 Language 可由多个 EditorState 独立持有 parser state；插件实例仍按各 view 独立创建。

## TDD RED → GREEN

先写新增测试，产品改动前运行：

`pnpm -C agentwiki --filter @agentwiki/client test src/components/MarkdownWorkspace.spec.tsx src/features/agent-session/AgentSessionPanel.spec.tsx`

- RED：7 failed / 130 passed，`/tmp/agentwiki-task2-red.log`。两个长文失败分别是 unrelated rerender 更换 Language facet 与同一活动行移动更换 DecorationSet；会话的初始定位、本人发送、near-bottom 轮询、切换会话、异步 resize 五项未定位。历史上翻不跟随与后台解析用例当时已通过，保留为契约回归。
- GREEN：137/137，`/tmp/agentwiki-task2-green.log`。
- 扩展契约回归：`pnpm -C agentwiki --filter @agentwiki/client test src/components/MarkdownWorkspace.spec.tsx src/features/agent-session src/features/page/PageEditor.spec.tsx`，6 files / 312 passed，`/tmp/agentwiki-task2-regression.log`。覆盖发送/授权/候选 ledger 与 PageEditor 显式保存、接受、Undo 边界。
- client typecheck：`pnpm -C agentwiki --filter @agentwiki/client exec tsc --noEmit` exit 0，`/tmp/agentwiki-task2-typecheck.log`。
- 四个产品/spec 文件 targeted eslint exit 0，`/tmp/agentwiki-task2-lint.log`；`git diff --check` exit 0。

## 实际组件 Chrome 量化

Chrome `154.0.8037.98`，全新 headless context，URL `http://127.0.0.1:5192/e2e/fixtures/editor-stability.html`。fixture 直接挂载真实 MarkdownWorkspace/AgentSessionPanel/Registry，API 请求全部 Playwright 本地拦截，未注册账号、写真实页面或访问生产内容。文档 98,700 字符/4,561 行，含中文段落、标题、强调、列表、引用、长 URL、Wiki links、表格、代码围栏；纯文本长文为额外控制组。

每个布局在固定深处源锚点采 70 帧（约 1 秒）纯滚动结束+无关 rerender，以及 70 帧同一活动行连续移动；精确比对文档与选区，记录 syntaxTree length、decorations、reconfigure、window scrollY、cm.scrollTop。实际 DOM 几何数据不是 jsdom rect stub。

| 浏览器宽×高 | 协作面板 | 编辑宽 px | 滚动/rerender 锚点波动 px | 同行移动锚点波动 px | 两阶段新增 reconfigure | 逐字输入期间最小树覆盖 |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| 900×800 | 开 | 512 | 0.00 | 0.00 | 0 / 0 | 98701 |
| 900×800 | 关 | 852 | 0.00 | 0.00 | 0 / 0 | 98701 |
| 1440×800 | 开 | 1000 | 0.00 | 0.00 | 0 / 0 | 98701 |
| 1440×800 | 关 | 1000 | 0.00 | 0.00 | 0 / 0 | 98701 |

四布局的非活动标记数稳定，树覆盖始终完整 98,700；同行移动未新增 Undo。逐字符实际浏览器输入 `连续中文abcdefghij123456`（20 字）后 Enter/Backspace，源码精确等于期望，每字后的 Language 稳定、树覆盖没有退回约 3000 字符，光标处于视口内。随后真实 candidate replacement→Undo→Redo→Undo 精确恢复人工草稿；pages 更新和 resolver scope 切换保留 parser，scope 切换待响应时旧 link href 为 0 个，新授权链接按新作用域替换。

真实 Agent 会话 viewport：30 轮长历史初入底部；从 scrollTop=120 发消息后 bottom distance=0；流式增长后 bottom distance=0；上翻至120后最终回复保持120。测量：`{"sent": {"top": 8846, "height": 9124, "client": 278}, "streamed": {"top": 10166, "height": 10444, "client": 278}, "historical": {"top": 120, "height": 10146, "client": 278}}`。组件测试另有近底部/远底部、切换会话及 ResizeObserver 延迟增长/清理回归。

最终 Chrome：7/7 passed，50.9s，`/tmp/agentwiki-task2-browser-final.log`；完整逐帧附录在 `/tmp/agentwiki-task2-browser-results.json` 的 geometry/conversation-scroll/resolver attachments。可复跑：先 `pnpm -C agentwiki --filter @agentwiki/client dev --port 5192 --strictPort`，再 `AGENTWIKI_WEB_URL=http://127.0.0.1:5192 pnpm -C agentwiki --filter @agentwiki/client exec playwright test e2e/editor-stability.spec.ts --workers=1`。

## Concerns / 未验边界

- 原用户 #9/#11 所在完整页面的原始操作路径未重新执行，结论限于已定位机制和真实组件本地 fixture，原报告保留待验，不能直接声称生产缺陷关闭。
- macOS 原生拼音候选/组合态 Space/Enter、候选窗邻近与重复字漏字未实际验收。insertText 与合成 composition 守卫测试不能替代原生 IME。
- 真实 provider、完整 PageEditor 浏览器 Save/刷新回读、窄面板实际产品入口、独立审查、主分支集成与部署由控制器后续验证。现有 PageEditor 组件契约312项不等于这些产品验收。
- 页面/资源/输入发生真实变化时动态扩展仍可能 reconfigure；本修复保证 Language/解析缓存稳定，没有声称所有输入都零 reconfigure。活动行显示源码及局部合理换行保持设计行为。
- 早期 `/tmp/agentwiki-task2-browser.log` 是 fixture harness 初始化/路径拦截修正前的中断记录，不是最终验收；最终证据以 browser-final.log/results.json 为准。
