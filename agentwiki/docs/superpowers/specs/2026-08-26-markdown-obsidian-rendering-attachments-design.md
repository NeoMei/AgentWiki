# AgentWiki Markdown、Obsidian 兼容与附件设计

**日期：** 2026-08-26

**状态：** 已确认，待实施

**范围：** 页面查看、页面编辑预览、历史版本预览、任务列表交互、常用 Obsidian Markdown、数学公式、Mermaid、页面嵌入与 Space 图片附件

## 1. 背景与目标

AgentWiki 当前使用 `react-markdown`、`remark-gfm`、`remark-breaks`、标题锚点和代码高亮渲染 Markdown。标准 Markdown、GFM 表格、删除线、脚注、自动链接、代码块和简单 `[[Page Name]]` 双链已经可用，但页面模板中的 checklist 只被渲染为禁用 checkbox，用户无法在页面查看态完成任务。

根因不是 CSS：`remark-gfm` 按规范生成 `disabled` checkbox，而共享 `Markdown` 组件没有任务点击回调、源码位置映射、页面写权限或保存语义；`PagePreview` 也没有 checklist 更新和冲突处理。当前测试只覆盖基础 Markdown、标题、普通链接和简单双链，没有定义任务列表交互契约。

与 Obsidian 阅读视图相比，当前还缺少 Callout、`==高亮==`、别名/章节/块双链、页面与图片嵌入、数学公式和 Mermaid。表格、图片和复杂内容在窄屏上的布局也需要统一完善。

本设计的目标是：

1. 建立一套由 AST 驱动的共享 Markdown 扩展层，供页面查看、编辑器预览和历史版本复用。
2. 让有页面编辑权限的用户可以在查看态直接完成 checklist，并沿用现有版本与乐观并发机制。
3. 支持常用 Obsidian 阅读语法、KaTeX、Mermaid、页面/章节嵌入和受权限保护的图片附件。
4. 保持原始 Markdown 可编辑、可同步、可恢复，不把渲染产物写回正文。
5. 不扩大本地同步的隐私边界，不自动上传 Obsidian 目录中的二进制文件。

## 2. 已确认的产品决策

### 2.1 checklist 保存语义

- 页面查看态：有编辑权限的用户点击后立即保存，并产生现有页面版本记录。
- 编辑器预览态：点击只修改当前草稿，继续由编辑器“保存”按钮统一提交。
- 只读用户和历史版本：展示任务状态，但不能修改。

### 2.2 Markdown 兼容范围

本期支持：

- CommonMark 与 GFM 现有能力。
- Obsidian Callout 与折叠状态。
- `==高亮==`。
- 页面双链、别名、标题锚点和块锚点。
- 页面、章节和图片附件嵌入。
- KaTeX 行内和块级数学公式。
- Mermaid fenced code 图表。
- 图片、表格、公式和图表的响应式布局。

本期不支持：

- 任意原始 HTML 执行。
- Obsidian 第三方插件语法。
- 自动上传本地 Obsidian 目录中的图片或其他二进制文件。
- 视频、音频和 PDF 等通用附件预览。
- 完整替换现有 CodeMirror 编辑器或复制 Obsidian 插件运行时。

### 2.3 附件与存储

- 新增 Space 图片附件系统，支持编辑器上传、拖放、粘贴和选择已有附件。
- 二进制保存在部署目录之外的本机持久化目录；PostgreSQL 保存权限和元数据。
- 文件按 SHA-256 内容寻址，并通过存储接口隔离具体实现，为未来 S3/MinIO 留出扩展点。
- 本地知识同步仍不上传二进制原文件；附件只能由已授权的人类用户显式上传。

## 3. 用户可见的语法和行为

| Markdown | 页面查看态 | 编辑器预览态 |
|---|---|---|
| `- [ ]` / `- [x]` | 有编辑权时点击即保存，否则只读 | 修改草稿，不自动保存 |
| `> [!NOTE]` | Obsidian 风格 Callout | 同查看态 |
| `> [!WARNING]-` | 默认折叠的 Callout | 同查看态 |
| `==highlight==` | 高亮文本 | 同查看态 |
| `[[Page]]` | 跳转到同一 Space 页面 | 同查看态 |
| `[[Page\|Alias]]` | 显示别名并跳转 | 同查看态 |
| `[[Page#Heading]]` | 跳转目标标题 | 同查看态 |
| `[[Page#^block-id]]` | 跳转目标块 | 同查看态 |
| `![[Page]]` | 嵌入目标页面 | 同查看态 |
| `![[Page#Heading]]` | 嵌入目标章节 | 同查看态 |
| `![[image.png]]` | 加载同一 Space 图片附件 | 同查看态 |
| `$x^2$` / `$$x^2$$` | KaTeX | 同查看态 |
| fenced `mermaid` | Mermaid SVG 图表 | 同查看态 |
| `![](https://...)` | 安全 HTTPS 外链图片 | 同查看态 |

常见 Callout 至少支持 `note`、`abstract`/`tldr`、`info`、`todo`、`tip`、`success`、`question`、`warning`、`failure`、`danger`、`bug`、`example` 和 `quote`，未知类型按中性 Callout 降级。`+` 表示默认展开且可折叠，`-` 表示默认折叠。

未解析、重名、无权访问或超限的引用必须显示局部提示，并保留原始标记；不得静默删除文本或导致整页渲染失败。

## 4. 统一 Markdown AST 架构

### 4.1 单一管线

`Markdown` 成为共享的渲染边界，所有页面入口使用同一插件顺序和组件映射：

```text
Markdown source
  -> CommonMark / GFM AST
  -> AgentWiki Obsidian extensions
  -> safe HAST
  -> React components
  -> page view / editor preview / version preview / nested embed
```

扩展层必须基于成熟的 CommonMark/remark AST 和节点 `position`，不得用不断增长的全局正则解析文档。局部源码修改保留原始切片、空白、缩进、换行和用户格式。

建议拆分为以下职责：

- `markdownSyntax`：Callout、高亮、wiki link、embed 和 block ID 的语法节点。
- `markdownTasks`：发现任务节点、生成稳定源码锚点并切换单个任务状态。
- `markdownResources`：批量收集和解析页面、章节、块与附件引用。
- `MarkdownRenderer`：共享组件映射、模式与限制上下文。
- `EmbeddedMarkdown`、`AttachmentImage`、`MermaidDiagram`：异步资源组件，错误局部隔离。

### 4.2 渲染上下文

共享渲染器接收显式上下文，而不是从全局状态猜测：

```ts
type MarkdownRenderMode = 'page' | 'editor-preview' | 'version' | 'embed';

interface MarkdownRenderContext {
  mode: MarkdownRenderMode;
  pageId?: string;
  spaceId?: string;
  canEdit: boolean;
  embedDepth: number;
  visitedPageIds: ReadonlySet<string>;
  limits: MarkdownRenderLimits;
}
```

没有 `spaceId` 或权限上下文的历史/静态调用仍可渲染 CommonMark、GFM、Callout、数学和 Mermaid，但页面/附件引用显示为只读或未解析，不得发起无界请求。

### 4.3 HTML 与 URL

- 不引入 `rehype-raw`，原始 HTML 使用 `skipHtml` 或等价策略跳过。
- 自定义 URL transform 只允许产品内部路由和明确协议。
- 外链图片仅允许 HTTPS，启用 lazy loading、异步解码和 `referrerPolicy="no-referrer"`。
- `javascript:`、`data:`、`file:`、不受控 `blob:` 和协议相对外链均不得进入可执行或可导航属性。

## 5. checklist 交互与并发

### 5.1 源码身份

任务节点携带：

- AST 源码起止位置。
- 当前 checked 状态。
- 列表项正文的规范化签名。
- 必要的父列表路径和相邻文本摘要。

切换函数只修改目标 marker 中的空格或 `x`，不得重排整个列表或重新序列化整份 Markdown。代码块、行内代码、普通文本和非任务列表中的相似字符不能被修改。

### 5.2 页面查看态

1. 服务端页面响应返回权威 `capabilities.canEdit`。
2. 可编辑 checkbox 点击后进行乐观更新并进入页面级串行队列。
3. 请求继续使用现有 `PATCH /pages/:id`，提交更新后的 `content` 和最新 `expectedUpdatedAt`。
4. 成功响应更新正文、`updatedAt` 和后续队列基线；现有 `PageService.update` 继续创建 `PageVersion`。
5. `409` 时重新读取页面，只有目标任务在最新正文中仍能唯一、安全定位且状态没有被等价修改时才重放一次。
6. 无法安全重放时回滚该点击，显示可访问的冲突提示，并保留服务端最新正文。

快速连续点击必须按用户操作顺序保存，不能并行使用同一个 `expectedUpdatedAt`。页面切换或卸载后，旧请求不得覆盖新页面状态。

### 5.3 编辑器预览与历史版本

- 编辑器预览调用同一个纯切换函数，并进入现有 `handleContentChange`、dirty、远端更新和显式保存流程。
- 版本预览将 `canEdit` 固定为 `false`；checkbox 不绑定写事件。
- 历史版本嵌入遵循动态引用语义，但显示“嵌入内容为当前版本”，避免把目标当前内容误认为历史快照的一部分。

## 6. 页面双链与嵌入

### 6.1 引用解析

页面引用可按 ID、slug、标题或同步路径匹配。比较值做 trim、Unicode NFC 和不区分大小写规范化，但显示文本保留原样。

确定性顺序：

1. 已有精确页面 ID。
2. 精确同步路径或 slug。
3. 精确标题。

任一级出现多个候选时返回 `ambiguous`，不得任选一个。无权限和不存在对客户端都返回统一 `unresolved`，避免资源枚举。

### 6.2 批量解析

新增有上限的批量解析接口，客户端先从 AST 收集唯一引用，再一次提交：

```text
POST /api/spaces/:spaceId/markdown/resolve
```

请求只包含规范化后的引用，不提交正文。响应返回当前主体可访问的页面/附件最小元数据、标题/块解析结果和不可解析状态。单次引用数量、字符串长度和响应大小均有硬上限。

页面内容仍通过受保护页面读取接口获取。嵌入组件缓存同一渲染树内的请求，避免多个相同引用重复读取。

### 6.3 深度、循环和大小

- 页面嵌入最大深度：3。
- 单份根文档最多嵌入：20。
- 限制嵌入后的总字符数和总异步资源数。
- `visitedPageIds` 检测直接或间接循环。
- 超限和循环以局部占位提示降级。

章节嵌入从匹配标题开始，到同级或更高标题之前结束。块 ID 本期用于链接定位，不增加块内容嵌入语法。解析保留原 Markdown 切片，不通过 DOM 文本反推源码。

## 7. 数学公式与 Mermaid

### 7.1 KaTeX

使用 `remark-math` 与 `rehype-katex`，并加载本地打包的 KaTeX CSS，不使用运行时 CDN。

安全配置至少包括：

- `trust: false`。
- 限制 `maxSize` 和 `maxExpand`。
- 不共享可被正文持久修改的全局 macro 状态。
- 错误公式显示局部错误与原始公式，不抛出到页面级错误边界。
- 输出保留 HTML + MathML 的可访问表示。

### 7.2 Mermaid

Mermaid 只在页面存在 `mermaid` fenced code 时动态导入，未使用 Mermaid 的页面不得加载该大型代码块。

配置至少包括：

- `startOnLoad: false`。
- `securityLevel: 'strict'`。
- 不调用返回的交互绑定函数。
- 禁止正文覆盖安全配置。
- 限制单图源码长度、单页图表数量和可接受的 SVG 尺寸。
- 最终 SVG 再经过专用允许列表清理，只保留绘图所需 SVG 元素和安全属性。
- 每个图使用唯一、不可由正文控制的渲染 ID。

语法错误、超限或清理失败时显示可读错误和原始 fenced code；其他 Markdown 内容继续渲染。

## 8. Space 图片附件

### 8.1 数据模型

新增 `SpaceAttachment`，至少包含：

```text
id
spaceId
displayName
nameKey
contentHash
storageKey
mimeType
sizeBytes
width
height
uploadedByUserId
status (active | archived)
createdAt
updatedAt
archivedAt
```

`nameKey` 在 Space 内保持活动名称唯一；由 Unicode NFC、trim 和大小写规范化产生。`storageKey` 只由受控哈希/版本生成，永远不拼接用户路径。数据库索引支持 Space 列表、名称解析、哈希复用和清理查询。

### 8.2 API

首期提供：

```text
GET  /api/spaces/:spaceId/attachments
POST /api/spaces/:spaceId/attachments
POST /api/spaces/:spaceId/attachments/:attachmentId/archive
POST /api/spaces/:spaceId/attachments/:attachmentId/restore
GET  /api/attachments/:attachmentId/content
```

- 列表接口有分页、搜索和状态筛选。
- 上传使用 multipart、单文件、硬大小限制。
- 归档与恢复是显式状态变更，不立即物理删除。
- 内容接口每次做 Space 读取权限检查，返回准确 MIME、`nosniff`、安全 Content-Disposition、ETag 和私有缓存头。

浏览器认证当前使用 localStorage Bearer Token，因此受保护图片由 `AttachmentImage` 通过现有 API 客户端读取 Blob，再创建 Object URL。令牌不得进入图片 URL、DOM、日志、浏览器历史或 Markdown 正文；Object URL 在资源变化和组件卸载时释放。

### 8.3 上传与选择体验

页面编辑器增加附件入口：

- 搜索并插入已有附件。
- 选择文件上传。
- 向编辑器拖放或粘贴图片后上传。
- 上传成功自动插入 `![[displayName]]`。
- 上传中显示进度；失败不插入损坏标记。

同名同内容复用已有附件；同名不同内容生成可预测的 `name (2).ext` 等名称并在插入前显示最终名称。

### 8.4 文件系统存储

定义 `AttachmentStorage` 接口，首期实现本地内容寻址存储。生产默认路径在代码部署目录之外，例如：

```text
/var/lib/agentwiki/attachments
```

Docker 使用独立命名卷，并挂载到需要读取或清理附件的 API 与 worker 服务。systemd 的 API 与 worker 使用同一个受控目录。配置通过 `ATTACHMENT_STORAGE_PATH` 提供，启动时验证：

- 路径是显式、窄范围的绝对目录。
- 目录存在或可安全创建。
- API 服务可写。
- 可用空间达到最低门槛。

上传流程：同文件系统临时文件 -> 流式大小/哈希 -> 格式与尺寸校验 -> `fsync` -> 原子发布内容文件 -> 数据库元数据。数据库失败产生的孤儿文件由精确清理和周期性协调处理；已有同哈希文件不得因单次元数据失败被删除。

### 8.5 格式、配额与生命周期

首期允许 PNG、JPEG、WebP、GIF；拒绝 SVG、HTML、PDF、视频、音频和未知格式。扩展名、声明 MIME 与文件魔数必须一致，并限制宽、高和总像素数。

默认配置：

- 单文件 10 MiB。
- 单 Space 500 MiB。
- 文件名最长 200 个 Unicode 字符，并同时受 UTF-8 字节数限制。

Space 配额按活动附件的逻辑字节数计算，底层内容去重不能绕过配额。归档附件从选择器隐藏，但名称在保留期内继续保留，已有页面引用仍可读取；同名新上传使用递增名称。归档可在保留期内恢复。保留期结束、归档元数据完成受控清理且没有任何有效附件元数据引用底层哈希后，清理任务才删除内容文件。备份与恢复必须同时覆盖 PostgreSQL、附件目录和 SHA-256 清单。

## 9. 权限模型

- `GET /pages/:id` 在完成现有授权后返回服务端权威 `capabilities.canEdit`，客户端用它控制 checklist、编辑和删除动作。
- 附件读取使用与 Space 页面读取相同的成员边界。
- 上传、归档与恢复使用与人类页面编辑相同的权威写权限。
- Agent 不得上传、归档或恢复二进制附件；Agent 提案可以引用已存在的附件名称。
- 服务端不能信任客户端的 `canEdit`、MIME、文件名、Space ID 或资源解析结果。
- 页面/附件解析只在指定 Space 内运行；无权访问和不存在返回相同外部结果。

## 10. 错误、状态与可访问性

- checkbox 保存中有局部 pending 状态，避免整页锁定；同一页写请求按顺序执行。
- 保存、冲突、回滚、上传和解析错误通过 `aria-live` 或 `role="alert"` 传达。
- checkbox 可用键盘操作，并保留原生 checked/disabled 语义。
- Callout 折叠使用按钮、`aria-expanded` 和可见焦点样式。
- 附件选择器使用现有 ModalDialog 的焦点陷阱、Escape、返回焦点和移动端布局。
- Mermaid、公式、表格和图片容器不得撑破 390px 视口；表格和超宽内容局部横向滚动。
- 图片提供 Markdown alt text 时必须保留；Obsidian 图片嵌入没有 alt 时使用文件名作为可读替代。

## 11. 安全边界

### 11.1 Markdown 与渲染

- 保持 `react-markdown` 的安全默认值，不启用原始 HTML。
- 所有自定义 AST 节点通过 React 组件渲染，不把用户输入直接传给 `dangerouslySetInnerHTML`。
- Mermaid 返回 SVG 是唯一需要受控 HTML 注入的路径；必须先严格配置、清理和限制。
- KaTeX 使用不可信输入配置，禁止可访问外部资源或注入 HTML 的命令。
- 资源解析、嵌入和 Blob 读取都有取消、数量和大小限制。

### 11.2 附件

- 验证扩展名、声明 MIME 和魔数。
- 拒绝路径分隔符、控制字符、空名、保留名称和过长 UTF-8 名称。
- 限制文件大小、尺寸和总像素，防止内存与解压炸弹。
- 临时文件权限和存储目录权限遵循最小权限。
- 响应设置 `X-Content-Type-Options: nosniff`，不允许浏览器将图片嗅探为脚本或 HTML。
- 配额检查和最终元数据写入必须在并发上传下保持正确，不能通过并行请求超额。

### 11.3 运维

- 健康/诊断检查区分附件目录不可写、空间不足和配置缺失。
- 部署脚本不得用 rsync 或清理命令覆盖附件目录。
- 生产部署前同时制作数据库与附件备份，并验证非空和清单可读。
- 恢复演练验证数据库记录与内容哈希一致；缺失内容显示局部不可用，不导致 API 崩溃。

## 12. 测试策略

### 12.1 AST 与组件单元测试

- 普通、嵌套、引用中的任务列表。
- fenced/inline code 中的 `- [ ]` 不被识别。
- 只切换目标 marker，其他原文逐字节保持。
- Callout 类型、折叠、高亮、别名、标题、块 ID。
- 页面/章节/附件嵌入、块链接和未解析状态。
- 正确/错误/超限 KaTeX 与 Mermaid。
- CommonMark、GFM 表格、脚注、代码高亮和换行回归。
- 页面查看、编辑器预览和历史版本的交互模式。

### 12.2 服务端与数据库测试

数据库集成使用专用 `MARKDOWN_TEST_DATABASE_URL` 和随机 `markdown_test_*` schema。测试工具必须验证测试数据库名与 schema 前缀，并在 `finally` 只删除精确生成的 schema；禁止迁移或清理 PostgreSQL `public`。

覆盖：

- 页面 capability 与实际 PATCH 权限一致。
- checklist 更新产生版本并正确处理 `expectedUpdatedAt`。
- viewer、Space 外用户和 Agent 的附件边界。
- 跨 Space/无权引用不泄露存在性。
- MIME 伪造、SVG、路径穿越、过大文件、过大像素和配额。
- 内容去重、同名、归档、保留期、孤儿协调。
- 文件写入或数据库写入失败时无可见半成品。
- 并发上传不能突破名称唯一和 Space 配额。

### 12.3 UI E2E

Playwright 在桌面和 390px 移动视口完成：

1. 从任务模板创建页面。
2. 查看态勾选任务并刷新验证。
3. 打开版本历史验证只读状态。
4. 编辑预览勾选任务，验证只改草稿。
5. 上传、粘贴和拖放图片并保存。
6. 验证 Callout、高亮、双链、页面/章节嵌入、KaTeX 和 Mermaid。
7. viewer 验证只读和附件读取边界。
8. 缺失引用、错误公式/图表和循环嵌入局部降级。
9. 移动端表格、图片、公式和图表不撑破页面。

### 12.4 安全与性能

- 原始 HTML、`javascript:`、恶意 Mermaid 标签/点击、KaTeX 不可信命令不能执行。
- JWT 不出现在附件 URL、DOM、日志或历史中。
- 不含 Mermaid 的页面不加载 Mermaid chunk。
- Markdown 引用批量解析，不产生无界 N+1 请求。
- 达到所有数量/大小限制时页面仍可读、可编辑。
- 典型任务模板点击响应和普通 Markdown 初始渲染不出现可感知回退。

### 12.5 完整门禁

实施完成后运行客户端、服务端、专用数据库集成、全仓测试、lint、typecheck、build、`git diff --check` 和真实 UI E2E。测试失败或数据库集成被跳过时不得声称完成。

## 13. 文档与产品说明

- 修正当前“Obsidian 式实时预览，所见即所得”的过度表述，改为明确的“Markdown 编辑 + 共享预览”。
- 增加支持语法表、任务保存语义、附件限制、嵌入动态性与历史版本提示。
- 明确本地同步不上传二进制附件，附件由人类用户显式操作。
- 运维文档增加存储路径、Docker volume、容量、备份、恢复和健康检查。

## 14. 主要依赖依据

- `react-markdown` 官方说明其默认安全渲染、插件机制、自定义组件和原始节点位置：<https://github.com/remarkjs/react-markdown>
- `remark-math` 官方组合为 `remark-math` + `rehype-katex`：<https://github.com/remarkjs/remark-math>
- KaTeX 官方选项定义 `trust`、`maxSize`、`maxExpand` 和错误行为：<https://katex.org/docs/options.html>
- Mermaid 官方安全等级中，`strict` 会编码 HTML 并禁用点击：<https://mermaid.js.org/config/usage.html#securitylevel>

依赖版本在实施计划开始前根据当前 lockfile 和官方兼容范围固定；不得使用未固定版本 CDN。

## 15. 发布边界

设计确认和本地实施不自动授权：

- GitHub push 或合并。
- npm 包发布。
- 生产数据库迁移。
- 生产附件目录创建、服务重启或部署。

本功能包含数据库迁移和新的持久化数据目录。生产发布必须另行授权，并经过只读预检、数据库与附件双重备份、磁盘容量检查、迁移检查、服务健康、鉴权读取、受控上传/checklist 写入 smoke 和浏览器验收。

## 16. 验收标准

以下条件全部满足才算本地实现完成：

1. 任务模板 checkbox 在页面查看态按权限可点击并持久化，编辑预览只修改草稿，历史版本只读。
2. 所有页面入口共用同一 AST 渲染管线，没有为某个 view 单独复制 Markdown 规则。
3. Callout、高亮、增强双链、块锚点、页面/章节嵌入、KaTeX 和 Mermaid 按本设计工作。
4. Space 图片上传、选择、粘贴、拖放、权限读取和 `![[image]]` 渲染完成。
5. 原始 HTML、恶意公式/图表、伪造图片和跨 Space 引用不能突破安全边界。
6. 并发 checklist、页面更新和附件上传不会丢失数据、覆盖他人修改或突破配额。
7. 桌面与 390px UI、键盘操作、错误状态和可访问提示通过真实浏览器验收。
8. 专用 PostgreSQL 集成测试实际执行且无 skip，完整仓库门禁全部通过。
9. 用户文档、运维文档和部署/备份边界与实际行为一致。
