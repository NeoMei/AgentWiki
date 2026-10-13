# 个人笔记正文标记

## 需求与根因

用户要求参考批注界面：个人笔记关联的文字，在阅读和编辑状态都能看到标记，并可从标记找到笔记。最终明确：有笔记的行右侧有黄色气泡图标；文字高亮和图标始终存在，笔记按钮只控制面板。

修复前，PageEditor 仅将 notes 传给侧栏；PagePreview 的 notes hook 位于懒加载侧栏，正文没有笔记数据。已用真实 PagePreview、本地合成 API 和真实 localStorage 复现：四条笔记存在，正文及打开笔记面板后均无标记。before.jpg 记录初始正文外观。

## 实现结果

- 阅读页和编辑页都使用同一个个人笔记生命周期和严格的 scope（账号、Space、页面）隔离。
- 有效笔记在正文中常驻浅琥珀高亮、下划线和行旁黄色气泡；当前卡片加强显示。关闭侧栏时标记仍保留。
- 阅读页标记不改写 Markdown；编辑页 CodeMirror 标记和气泡是装饰层，不进入 undo、保存或 dirty 状态。图片预览、任务复选框和链接行为保持独立。
- 点击标记或面板“定位原文”可以互相跳转；多条同一行笔记合并为一个带数量的气泡。定位折叠 details 时会先展开目标祖先。
- 面板采用紧凑筛选、灰色原文引用、白色卡片和明确的待处理/已解决状态，不伪造时间或操作按钮。
- 选中文字后在选区附近出现“添加笔记”，展开后显示原文引用和输入卡片。提交再次校验身份、原文和版本；原文过期、存储失败或组件禁用时保留草稿并允许重新选择，存储失败不会追加临时笔记或造成重复。
- 常驻标记不依赖面板开关；面板按钮只负责打开/关闭。手机端面板改为正文流式布局，打开时按页面工具栏实际高度保留滚入间距，编辑面板标题不再覆盖顶部工具栏。
- 面板笔记只保存在当前浏览器的个人笔记存储中；不会自动勾选、发送 Agent 或修改共享正文。

## 验证结果

本地 fixture 使用真实 PagePreview、PageEditor、Markdown、MarkdownWorkspace、PersonalNotesPanel、SelectionNoteComposer、usePersonalNotes，API 与 socket 仅为合成传输替身。未访问或修改远程用户笔记/文档，不代表生产鉴权或 Agent 真实调用验收。

运行命令：

```sh
node apps/client/e2e/fixtures/personal-notes-api.mjs
AGENTWIKI_DEV_API_ORIGIN=http://127.0.0.1:5182 pnpm --filter @agentwiki/client dev --host 127.0.0.1 --port 5178 --strictPort
```

浏览器回放已验证：
- 默认桌面阅读页：关闭面板仍显示常驻高亮和黄色气泡；点击气泡打开对应卡片。
- 真实阅读页拖选、填写、提交后，第 6 条笔记即时出现高亮、气泡和面板卡片；提交入口不会在下一次 selectionchange 中重新出现。
- 编辑页真实 CodeMirror 选文可打开浮层，提交后保存按钮仍禁用、共享正文未改写；同一行两条笔记合并显示数量。
- 任务文字拖选不切换任务复选框，链接上的笔记标记不导航。
- 账号切换清空并恢复对应 scope 的笔记；面板筛选和 resolved 卡片保持原状态。
- 390×844 临时视口（浏览器 CSS 宽 354）：编辑器气泡右缘 334.55、文档 scrollWidth 354，无水平溢出；面板改为正文下方 static 流式布局；浮层坐标在视口内，Escape 可退出。最终滚入间距由代码按工具栏实测值设置，最后一次浏览器会话在 HMR 后断开，未把该最后微调重新做一次截图验收。

测试与静态检查：

- 客户端全量：148 files / 2365 tests passed。
- client build passed；client lint passed；tsc passed。
- composer 增量：4 files / 245 tests passed；tsc 和 diff --check passed。
- NoteMargin 与阅读标记增量：3 files / 20 tests passed；details 折叠/展开回归通过。
- 最终 PagePreview/PageEditor 定向：2 files / 188 tests passed。
- 独立复审：composer、持久化失败重试、折叠气泡、身份/版本校验、Agent 状态边界均通过；无未关闭的阻塞 finding。

## 边界与发布状态

阅读标记只覆盖 resolveAssistTarget 能提供唯一、有效上下文的位置；无法严格定位的公式、实体、图片或已歧义文本会保留笔记但不猜测高亮。生产原文和远程 MCP 文档没有修改。

本轮代码已提交到本地分支 `codex/editor-single-line-selection`，提交 `fef21101`；尚未 push 或部署。

