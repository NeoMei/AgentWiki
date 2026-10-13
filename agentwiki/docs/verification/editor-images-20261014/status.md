# 编辑态图片实时预览

- 日期：2026-10-14。
- 基线：`5dce485e`，包含已验证的单行选区修复；Web 包版本仍为 0.12.25。
- 工作分支：`codex/editor-single-line-selection`。
- 状态：本地实现、最终客户端门禁、真实 Chrome 交互与独立复审通过。
- 发布边界：本轮未推送 GitHub、未部署生产、未修改远程页面正文。

## 用户要求与根因

编辑状态应显示图片，点击图片后显示原始链接供编辑。此前仅已解析 Wiki 附件有图片 widget；普通 Markdown 图片没有渲染，部分标记还被隐藏。普通相对路径图片未加入附件解析计划，已有附件 widget 没有点击展开逻辑。

## 实现范围

- 普通 Markdown 图片和 Wiki 附件都可预览；未聚焦的首行图片也显示。
- 点击、Enter 或空格展开对应原始 Markdown，编辑光标进入该行；离开行后恢复图片。
- 相对附件沿用当前页面/Space 的解析与 Blob 加载，阅读/编辑共用图片地址允许规则。
- 图片失败保留可点击的编辑入口。代码里的图片保持源码；合法跨多行图片保留完整源码，不做不支持的跨行装饰替换。
- 按现时 DOM 定位图片，避免前文插入后跳到旧偏移；销毁图片 DOM 时取消请求并回收 Blob URL。

## 验证记录

修复前真实 Chrome：`editor-images.html` 首行显示 `![首行图片](...)`，第二行图片仅显示说明和路径，未呈现图片。RED 截图见 `before.jpg`。

初轮真实 Chrome 已检查：首图默认预览、点击展开完整链接及 title、离开恢复、Enter 展开第二图、修改 URL 片段并撤销、失败图片可编辑、代码字面量保留。

本地附件样例使用 `editor-images-api.mjs` 模拟 resolver 和二进制传输：两种图片均通过 Blob 显示，`naturalWidth > 0`，Wiki 点击展开 `![[test.jpg]]`。该样例只验证前端完整加载路径，**不作为生产鉴权验收**。

最终冻结版本复验通过：普通图片 `naturalWidth > 0`、点击第二图后显示完整原始链接；两种附件 Blob 加载、Wiki 点击展开/离开恢复、相对路径原文展开；旁边正文拖选“上方图片应在进入”高亮可见，活动行仍为2%透明黑。浏览器错误日志为空。

窄屏覆盖：viewport override 390×844；用户浏览器缩放下实际 CSS 宽度354px，`scrollWidth = clientWidth = 354`，两图宽度290.5px，均已加载且没有横向溢出，点击展开通过。已恢复原窗口尺寸。

## 最终门禁与审查

- 客户端全套：144 files / **2325 tests passed**，0失败；`pnpm --filter @agentwiki/client test`。
- `pnpm --filter @agentwiki/client build`、`lint`、`git diff --check` 均通过。构建仍有既有大 chunk 提示。
- 实现定向检查：4 files / 279 passed；TypeScript 检查通过。
- 独立复审 `image_preview_review` 无阻断发现，覆盖从1bbb428e开始的整体编辑器修改。
- 复审发现并修复同步全文解析回退：现复用语法候选扫描，总解析预算32K/256候选；18万字+1图只解析26字符，独立复测稳定约4–5ms。超预算内容保留源码。
- 复审发现并修复正文假定义：不会将普通段落里的 `[cover]: ...` 升级为引用地址；独立验证7个定义/链接/容器案例通过。
- 未运行全仓后端门禁、未验证生产新版；本轮仅客户端变更。附件模拟 API 不能证明生产授权状态。

## 已知保守边界

- 合法跨物理行的图片语法、列表内4空格续行图片、超过候选解析预算的内容保持完整原文；不声称所有 Markdown 图片语法都能实时预览。
- 2空格列表、普通单行/行内、blockquote、普通引用式图片均有覆盖。

## 截图

- `before.jpg`：原缺陷。
- `preview.jpg`：编辑态默认图片。
- `click-source.jpg`：第一图继续预览、第二图点击后显示源码。
- `narrow.jpg`：窄屏缩放。
- `images-and-selection.jpg`：图片与单行选区同时正常。

## 可复验入口

1. 在 `agentwiki` 目录运行 `node apps/client/e2e/fixtures/editor-images-api.mjs`（仅绑定 127.0.0.1:5181）。
2. 运行 `AGENTWIKI_DEV_API_ORIGIN=http://127.0.0.1:5181 pnpm --filter @agentwiki/client dev --host 127.0.0.1 --port 5178 --strictPort`。
3. 打开 `http://127.0.0.1:5178/e2e/fixtures/editor-images.html`；附件样例按钮使用模拟 API，其余样例不需后端。
4. 本地样例内容只在内存中，重置即可恢复；完成后关闭本次服务。
