# 可视编辑技术试点：真实 Markdown 往返

结论：**Tiptap 3.31.4 可以作为隔离的标准 Markdown 块编辑候选，当前证据不允许全量替换 AgentWiki 编辑器。** 表格增列、标准图片属性、任务勾选的编辑器模型命令已实际通过；直接全篇 parse → serialize 会改写源格式，YAML、HTML、脚注和单行双美元数学语法出现结构或内容变化。原文保留策略可以解决“打开不编辑零 diff”，仍不能解决“局部编辑不重写无关段落”。本次完成的是可运行技术探针，没有实现产品可视编辑 UI。

## 实验边界与复现

- 日期：2026-10-06（Asia/Shanghai）。工作区 HEAD：`26a5722bfd8310acbd281f0f47b7075229bed22c`。共享工作区的并行实现不属于本探针变更。
- 环境：macOS / Node `v24.18.0` / npm `11.16.0` / jsdom `26.1.0`。所有 Tiptap 官方包固定 `3.31.4`，从 npm 实际安装；不是第三方 `tiptap-markdown` 包。
- 依赖安装在 `/tmp/agentwiki-visual-editor-probe.i1SiLz`；仓库仅保存脚本、fixture 和输出，无 node_modules、package-lock、产品依赖或源码改动。本探针未 commit。
- [probe.mjs](visual-editor-probe/probe.mjs)、[fixtures.json](visual-editor-probe/fixtures.json)、[run.sh](visual-editor-probe/run.sh)、[summary.json](visual-editor-probe/results/summary.json)、[包版本](visual-editor-probe/runtime-packages.json)、[运行日志](visual-editor-probe/probe-run.log)均已保存。每个 fixture 有输入、输出、diff、Tiptap JSON、重解析 JSON、现有 remark 前后 AST。
- 从仓库根执行：`sh agentwiki/docs/verification/document-workspace-20261006/visual-editor-probe/run.sh`。脚本在新 `/tmp` 目录安装固定直接依赖，输出保存在该临时目录，不覆写已归档证据。`PROBE_OUTPUT` 可设置结果位置，`AGENTWIKI_REPO` 可指定当前仓库。现有仓库须已有正常的 client / sync-protocol 依赖，因为探针直接导入真实 `obsidian.ts`，不复制或重写其实现。
- 已实际从新的临时目录执行 `run.sh` 成功。直接依赖版本见 receipt；未固定所有传递依赖，未来复现应对照 receipt。本轮 npm 有 esbuild 安装脚本提示，但 tsx 实际运行成功，无批准或修改全局安装策略。

## API 与当前语法核查

核查依据为官方 [安装文档](https://tiptap.dev/docs/editor/markdown/getting-started/installation)、[MarkdownManager API](https://tiptap.dev/docs/editor/markdown/api/markdown-manager)、[Editor API](https://tiptap.dev/docs/editor/markdown/api/editor)，以及**已安装的 3.31.4 官方包源码**。官方文档仍标注 Markdown 为 Beta；这是状态信息，切换结论来自下述实际测试。

实际调用 `new MarkdownManager({ extensions })`、`parse(source)`、`serialize(json)`；Editor 实际调用 `contentType: 'markdown'`、`getMarkdown()`。源码核验路径：

- `@tiptap/markdown/src/MarkdownManager.ts:73` 构造和 extension 展开，`:312` serialize，`:343` parse，`:954` HTML 通过 schema 规则转换；浏览器 DOM 存在时可能保留文本但丢掉不受 schema 支持的 HTML 标记。这也是本轮使用 jsdom 的原因，纯无 DOM 服务器结果不能冒充浏览器结果。
- `@tiptap/extension-table/src/table/table.ts:321` 表格 parse，`:362` serialize；Image `src/image.ts:136` parse；TaskItem `src/task-item/task-item.ts:157` parse。
- Mathematics `src/extensions/InlineMath.ts:207`、`BlockMath.ts:180` parse；block tokenizer 将 `$$x+y$$` 视为 blockMath，并在导出时加换行，这与当前 remark-math 的单行行为不同。

AgentWiki 当前真实配置：`Markdown.tsx:597` 使用 `skipHtml`；`:600` 为 `remarkGfm + remarkMath + obsidianPlugin + remarkBreaks`，其后为 KaTeX、标题、代码等 rehype 插件。`obsidian.ts` 定义 WikiLink、heading/block fragment、图片与跨页 embed、`==高亮==`、块锚点、callout 类型/标题/折叠标志。`MarkdownWorkspace.tsx` 当前仍持有 Markdown 字符串并使用 CodeMirror 实时装饰与资源解析。

当前没有 frontmatter 专用插件，原始 HTML 被 skipHtml；这两者**未被标为已有阅读能力**。保留原文件仍是编辑器安全边界。remark-gfm/remark-parse 实际 AST 中已有脚注节点；探针发现 Tiptap 将其变成普通链接，因此也不能把脚注丢失解释为“只是未知语法无需保留”。

## 实际结果

| 判据 | 实际结果 | 含义 |
| --- | --- | --- |
| MarkdownManager parse → serialize 字节不变 | **1 / 17** | 只有无末尾换行的规范化控制样例通过 |
| Editor 打开后直接 getMarkdown 字节不变 | **1 / 17** | 不能无条件导出后 autosave |
| 原文保留、无 doc update 则不导出 | **17 / 17** | 实际探针 guard 通过；尚未接入产品 |
| 序列化后再 parse 的 Tiptap JSON 不变 | **15 / 17** | YAML、HTML 自身重解析也变化；其余稳定不代表符合 AgentWiki 语义 |
| 现有 remark AST 严格等价 | **11 / 17** | 已移除 AST position；仍有 source offset、引用链接写法差异 |
| 消除资源 source offset、将普通引用式链接展开后等价 | **13 / 17** | 仅对 AST 结构意义作合理归一，不忽略数学、脚注、HTML、YAML变化 |
| 只插入“新增中文”，无关后缀字节不变 | **失败** | 重写加粗标记、列表标记、引用式链接和行尾 |
| 单用户 undo 回到初始 Editor JSON | **通过** | 不代表多用户或 Agent undo 隔离 |
| undo 后直接导出恢复初始原文字节 | **失败** | 仍是规范化后的源文本 |
| undo 后 JSON 等于基线则返回保留原文 | **通过** | 基线 guard 可以补零修改保存；不解决局部改动 |
| 表格 addColumnAfter | **通过，2 → 3 列** | 真正调用编辑器命令 |
| 图片 updateAttributes | **通过** | alt / src 更新并序列化 |
| taskItem transaction 勾选 | **通过** | 导出为 `- [x] 任务` |

“意义等价”比较运行真实当前 Obsidian 插件与 remark-gfm/math/breaks，不包含 React DOM、rehype、网络资源/权限解析；不得读作原生界面验收。原文保留 guard 仅保存载入 source 并跟踪 doc update；实际 selection transaction 未触发保存。正式实现还需以 baseline JSON 或内容等价判据处理 edit→undo，不能仅用永不清零的 dirty 布尔。

| fixture | 再交给当前解析器意义等价 | 专用模型 / 限制 |
| --- | --- | --- |
| 中文、全角、emoji、组合字符 | 通过 | 中文字符串完整；末尾换行变化。未测试真实 IME composition |
| GFM 表格、管道及反斜线转义、inline code、对齐 | 通过 | table/header/cell 节点真实存在；列宽文本和前置空行被重排 |
| 标准图片、相对图片/附件路径 | 通过 | 标准 image / link attrs 保留；未测试上传/点击/Space resolver |
| WikiLink、标题片段、块片段 | 通过 | 只作为 text 保存，非原生 WikiLink 节点；导出加反斜线转义后当前 remark 仍识别 |
| 块锚点、跨页 embed、Wiki 图片 | 通过 | text 保留，资源 source offset 会漂移；无 embed NodeView/资源解析 |
| 引用与 callout | 通过 | 普通 blockquote/text，保留 callout 类型/标题/折叠；无专用折叠操作 |
| Mermaid / 代码围栏 | 通过 | codeBlock 语言/源码保存；`~~~` 改为三反引号，无 Mermaid 图表 UI |
| 常规多行 KaTeX | 通过 | inlineMath / blockMath 节点存在；未验证可视公式编辑交互 |
| 数学边界：美元、单行双美元 | **失败** | `$$x+y$$` 从当前 inline math 改为 display math；latex trim 也变化。金额 `$5 与 $10` 在两解析器中均被当数学，不能算 Tiptap 新引入缺陷；探针记录 KaTeX Unicode warning |
| 嵌套列表 / 任务列表 | 通过 | ordered/bullet/task nodes 存在；源码缩进和末尾换行规范化 |
| YAML frontmatter | **失败** | 没有 raw/frontmatter 节点；开头当 horizontalRule，结尾当 Setext heading underline，导出破坏 delimiter |
| HTML / comment | **失败** | details/summary/mark/属性/注释丢失；当前阅读 skipHtml，导出后甚至可能显示原先隐藏的 HTML 文本 |
| 未知扩展集合 | **失败** | directive / property / `%%注释%%` 本轮文本保留；脚注变成普通链接，definition 丢失。`==高亮==` 本轮保留但只有 text |
| 源排版 / 引用式链接 | 意义通过，字节失败 | Setext/下划线/星号/引用定义改写。13/17“意义通过”不能豁免此源格式门槛 |
| CRLF | 意义通过，字节失败 | CRLF 变 LF 且末尾行尾消失 |

## 可复核反例

[局部编辑 diff](visual-editor-probe/results/local-edit.patch)：只改第一段仍产生这些无关变化：

```diff
-__未编辑段落__
+**未编辑段落**
-* 保留列表样式
+- 保留列表样式
-[附件][ref]
-[ref]: ../assets/原文.pdf
+[附件](../assets/原文.pdf)
```

[YAML diff](visual-editor-probe/results/yaml-frontmatter/diff.patch) 中 `---` delimiter 不再完整；[HTML diff](visual-editor-probe/results/raw-html/diff.patch) 中 148 字节原文只剩 32 字节普通文字；[脚注输出](visual-editor-probe/results/unknown-extensions/output.md) 是 `脚注[^注一](中文脚注)`，原脚注定义消失；[数学前后 AST](visual-editor-probe/results/math-dialects/renderer-after.json) 显示 display 节点转换。

## 可采用范围与剩余门槛

可采用：继续保留 CodeMirror 主入口，在隔离样例上用标准表格、图片、列表、代码、普通数学节点完成可视 UI 验证；该候选确实能操作结构，不必停留于标记高亮。加入原文保存、baseline JSON、禁止无变化 autosave，可避免“打开就改文档”。这项策略在探针中通过，但需要产品层验证。

需适配：原文片段映射与局部 patch 保存（未改块仍保留源字节、分隔符、引用定义和行尾）；自定义 WikiLink/embed/callout/block anchor/highlight 节点；对齐现有数学方言；YAML/HTML/未知节点的原始 source atom 或源码回退；真实脚注节点。仅以官方全篇 getMarkdown 输出替换 source 无法达成研究报告的保真门槛。未知语法在视觉画布暂不可编辑时，应显式保留原文块或回到源码，不可静默丢掉。

仍未验收：原生中文输入法、表格拖拽/图片粘贴上传、NodeView 可操作性、源码/可视切换和滚动光标恢复、附件 Space 权限/相对路径解析、Local Sync 真正差异、产品撤销与 Agent 候选隔离。本次未引入 CRDT。上述门槛与往返适配完成后才能决定替换范围；失败 fixture 或零编辑 guard 通过都不能被计为“产品可视编辑已完成”。
