# 本地知识扫描与 AgentWiki 同步设计

## 状态

- 已确认方向：本地扫描、本地生成知识、用户明确确认后同步。
- 本规格等待用户书面复核；复核通过后再编写实现计划。

## 目标

让已经接入 AgentWiki 的本地 Agent 能够处理两类本地来源：

1. 代码仓库。
2. 包含 Markdown、TXT、PDF、DOCX 的资料目录。

扫描、解析和同步编排发生在本地。OpenWiki 的 Wiki 综合可能调用用户配置的模型提供商；如果提供商不是本机回环地址，Agent 必须在首次模型调用前单独披露数据边界并获得确认。Agent 在本地展示 AgentWiki 同步预览，只有获得明确确认后才把派生 Wiki、关系和证据同步到指定 Space。AgentWiki 服务端不读取本地路径，也不把“允许同步”视为“允许直接发布”。

## 选型结论

| 项目 | 角色 | 采用方式 |
|---|---|---|
| [OpenWiki](https://github.com/langchain-ai/openwiki) | 本地 Wiki 编译器与 OKF v0.1 生产者 | 优先复用已安装的最新版 OpenWiki；AgentWiki 接受其 OKF 输出，不在服务端运行 OpenWiki |
| codebase-memory MCP | 代码结构、符号、调用关系、路由和架构证据 | 只用于代码来源，作为 OpenWiki 的结构化增强信息 |
| [MarkItDown](https://github.com/microsoft/markitdown) | PDF、DOCX、Markdown、TXT 等内容的本地 Markdown 归一化 | 只作为文档转换器，不承担 Wiki 生成、检索或服务端职责 |

OpenWiki 上游当前支持代码模式、Personal Mode、本地连接器，并输出 Google Open Knowledge Format v0.1。仓库中的 `openwiki/` 只是旧参考副本，不作为 AgentWiki 运行时依赖。已有 OpenWiki OKF 目录可以直接进入同步流程；没有 OpenWiki 时，本地 Agent 必须先提示用户安装或配置，不能静默安装或回退到服务端扫描。

暂不采用以下项目：

- Graphify：覆盖面很强且提供 MCP，但会与 codebase-memory 形成第二套代码图谱引擎；只有 codebase-memory 无法满足已验证需求时再评估。
- Docling：复杂 PDF 和版面解析更强，但比 MarkItDown 重；只有真实文档样本证明 MarkItDown 不够时再引入。
- DeepWiki Open：偏代码仓库 Wiki 应用，不能覆盖本次通用本地资料范围，并与 OpenWiki 职责重叠。

## 系统边界

### 本地 Agent

本地 Agent 是唯一的编排者，负责：

- 读取用户指定的本地路径。
- 判断来源是代码仓库、资料目录或两者混合。
- 对代码仓库调用 codebase-memory MCP，获取架构、符号、路由、依赖和关系证据。
- 对 PDF、DOCX、Markdown、TXT 调用 MarkItDown 或直接读取文本，统一为 Markdown。
- 调用 OpenWiki 生成或更新 OKF v0.1 Wiki 包。
- 检查 OpenWiki 模型提供商；非本地提供商必须在调用前向用户说明可能发送的内容并获得确认。
- 在本机计算同步摘要和差异。
- 向用户询问是否同步，并在得到明确肯定回答前停止。
- 用户确认后，通过 AgentWiki HTTP/MCP 接口上传知识包并查询运行结果。

### AgentWiki 服务端

AgentWiki 只负责：

- 验证 Agent Credential、Space Grant 和 Scope。
- 接收经过确认的 OKF 知识包。
- 将知识包写入现有 `Source → SourceVersion → IngestRun` 流水线。
- 把 OKF Markdown 文件编译为 Page，把 Markdown 链接编译为 Relation。
- 保存文件路径、内容哈希、来源摘要和证据片段。
- 生成 ChangeSet，并继续执行既有人工审核或 scoped auto-publish 策略。

服务端永远不接受或访问用户机器上的绝对路径。

## 本地处理流程

### 代码仓库

1. 本地 Agent 确认仓库根目录，遵守 `.gitignore`，排除 `.git`、依赖、构建产物、密钥文件和超大文件。
2. 使用 codebase-memory MCP 执行本地索引，不上传源码，不写持久化图工件到目标仓库。
3. 获取 `get_architecture`、关键符号、路由、依赖和必要调用链，形成结构化证据清单。
4. OpenWiki 在本地把仓库内容和结构化证据编译为 OKF Wiki。

### 文档目录

1. Markdown 和 TXT 直接读取。
2. PDF 和 DOCX 使用 MarkItDown 的离线转换器在本地转换为 Markdown；第一版禁用 Azure、LLM OCR 和其他云插件。
3. 加密、损坏或不支持的文件进入跳过清单，不静默丢弃。
4. OpenWiki 把归一化 Markdown 编译为 OKF Wiki。

### 混合目录

代码文件走 codebase-memory 增强，文档文件走 MarkItDown，最终进入同一个 OKF Wiki 包。第一版不处理图片、音频和视频。

## 同步前确认

同步询问发生在本地，且在任何 Wiki 内容、文件路径或证据片段上传之前。

Agent 必须展示：

- 本地来源的用户可识别名称，不展示绝对路径。
- 目标 AgentWiki Space。
- 将新增、更新、删除和保持不变的 Wiki 页面数量。
- 成功处理和跳过的文件数量。
- 预计上传大小。
- OpenWiki 使用的模型提供商，以及该提供商是否为本机服务。
- 上传范围：派生 Wiki、相对文件路径、内容哈希和少量证据片段；默认不上传完整源码。

标准询问：

> 已在本地完成扫描：新增 X 页、更新 Y 页、删除 Z 页，跳过 N 个文件。目标为「Space 名称」。是否同步到 AgentWiki？

只有用户在当前对话中明确肯定后才能继续。拒绝、取消或含糊回复都终止同步并清理临时文件。

OpenWiki 云模型确认和 AgentWiki 同步确认是两个独立边界：前者允许内容参与 Wiki 综合，后者允许生成结果进入 AgentWiki。一次确认不能替代另一次。

## 差异计算与隐私

为避免“为了预览先上传一遍”，差异在本地计算：

1. Agent 使用只读 MCP 工具按 `sourceKey` 获取 AgentWiki 中上次同步的页面相对路径和内容哈希。
2. `sourceKey` 是本地生成的不透明稳定标识，不包含绝对路径；本地路径到 `sourceKey` 的映射只保存在 `~/.agentwiki/sync-state.json`。
3. Agent 将服务端哈希清单与本地 OKF 清单比较，得到新增、更新、删除和未变化数量。
4. 用户确认前，AgentWiki 只向本地返回既有状态；本地数据不上传。

## OKF 同步包

网络传输使用一个 AgentWiki OKF JSON Envelope，避免为 ZIP 引入解析依赖：

```json
{
  "okfVersion": "0.1",
  "sourceKey": "opaque-stable-id",
  "name": "Project Docs",
  "kind": "code|documents|mixed",
  "producer": { "name": "openwiki", "version": "detected-version" },
  "documents": [
    {
      "path": "architecture/overview.md",
      "content": "# Architecture...",
      "contentHash": "sha256",
      "evidence": [
        { "sourcePath": "src/app.ts", "sourceHash": "sha256", "quote": "short excerpt" }
      ]
    }
  ]
}
```

约束：

- 只允许相对 POSIX 路径，拒绝绝对路径、`..` 和重复路径。
- 文档数量、单文档大小、总包大小和证据长度必须有限制。
- 服务端重新计算内容哈希，不信任客户端哈希。
- Front Matter 中的 `type` 和标准字段保留为页面元数据。
- Markdown 相对链接映射为编译关系。
- 默认只允许短证据片段；完整源码上传不属于第一版。

## AgentWiki 接口

### MCP 读取工具

`get_knowledge_sync_state`

- 输入：`spaceId`、`sourceKey`。
- Scope：`sources:read`。
- 输出：来源是否存在、上次同步时间、页面相对路径和内容哈希。
- 不返回完整页面内容。

### HTTP 同步接口

`POST /api/spaces/:spaceId/knowledge-syncs`

- 使用同一 Agent Credential 认证。
- Scope：`sources:write` 与 `runs:write`。
- 请求：multipart 上传 `.okf.json`，最大 10 MiB。
- Header：必须提供 `Idempotency-Key`。
- 服务端验证完成后创建或更新稳定的 OKF Source、写入 SourceVersion，并创建 IngestRun。
- 返回 `sourceId`、`sourceVersionId`、`runId` 和当前状态。

大包分片、断点续传和纯 MCP 大内容上传不在第一版范围；超过 10 MiB 时本地 Agent必须缩小知识包或报告限制。

### 运行与审核

同步 HTTP 接口已经创建 IngestRun，因此首次同步和内容更新不能再次调用 `start_source_run`。本地 Agent 使用返回的 `runId` 查询运行状态，并继续使用现有 `list_reviews` 和页面读取工具。`start_source_run` 只用于人工要求重新处理一个已经存在且内容未变化的 Source。同步确认只代表允许传输知识包，不代表允许发布：

- 默认生成 `pending_review` ChangeSet。
- 只有 Space、Agent 和有效 Scope 同时允许时，才沿用现有 scoped auto-publish。
- Agent 仍不能审批自己的 ChangeSet。

## 服务端映射

- 新增 Source 类型 `okf`，通过 `spaceId + sourceKey` 识别同一长期来源。
- 每次内容变化创建新的 SourceVersion；内容哈希未变化时返回 no-op，不创建运行。
- OKF `documents[]` 映射为现有 `FetchedSegment[]`，复用分块、Evidence、实体、关系、ChangeSet 和发布逻辑。
- 页面 `sourcePath` 使用 OKF 相对路径，从而支持后续更新和删除差异。
- 同步请求记录 Agent、Credential、Space、sourceKey、包哈希、用户确认声明和 Idempotency-Key；不记录本地绝对路径。

## 错误处理

- OpenWiki、codebase-memory 或 MarkItDown 缺失：本地 Agent说明缺失项并询问是否安装；不静默安装。
- OpenWiki 配置云模型：首次调用前披露提供商和数据范围；用户拒绝时不调用模型，也不生成或同步 Wiki。
- 本地解析部分失败：在确认界面列出跳过文件；用户仍可选择同步其余内容。
- 用户拒绝同步：不调用 AgentWiki 写接口，删除临时 OKF 包。
- OKF 格式、路径、大小或哈希校验失败：整个请求失败，不产生半个 SourceVersion。
- 重复 Idempotency-Key：返回原结果。
- 相同内容哈希：返回 no-op。
- Agent 在运行期间被暂停、撤销或失去 Space Scope：复用现有授权复核，运行失败且不发布。

## 用户接入体验

AgentWiki 生成的接入指令增加“本地知识同步”能力说明。用户仍只需把整段指令交给本地 Agent。Agent 完成连接后应报告：

- AgentWiki 连接状态。
- 是否发现 OpenWiki、codebase-memory MCP 和 MarkItDown。
- 当前可以扫描的来源类型。
- 缺失工具的安装选项。

用户随后可以直接说：“扫描这个目录，生成 Wiki，完成后先问我是否同步。”

## 测试与验收

### 自动化测试

- OKF Envelope 路径、大小、重复项、哈希和 Front Matter 校验。
- `sourceKey` 更新同一 Source，内容变化创建 SourceVersion，相同内容 no-op。
- OKF 文档映射为多 Page，Markdown 链接映射为 Relation。
- Agent Credential 和 Space Grant 的 Scope 交集正确生效。
- Agent 不能审批自己生成的 ChangeSet。
- Idempotency-Key 重试不重复创建 SourceVersion、Run 或 ChangeSet。

### 本地真实验证

使用一个包含以下内容的临时资料目录：

- 一个小型 TypeScript 仓库。
- 两个 Markdown/TXT 文档。
- 一个 PDF。
- 一个 DOCX。

验收路径：

1. codebase-memory 在本地生成结构化证据。
2. MarkItDown 在本地转换 PDF 和 DOCX。
3. OpenWiki 生成 OKF 包。
4. 用户确认前，AgentWiki 中不存在新增 Source、Version 或 Run。
5. 用户拒绝时不产生服务端数据。
6. 用户确认后，AgentWiki 创建 SourceVersion、Run、Evidence 和 ChangeSet。
7. 人工发布后，多页面 Wiki、内部关系和来源证据均可读取。
8. 修改一个文件后重复同步，只生成对应更新；再次无修改同步返回 no-op。

## 不做

- 不让 AgentWiki 服务端访问用户本地路径。
- 不在 AgentWiki 服务端运行 OpenWiki、codebase-memory 或 MarkItDown。
- 不默认上传完整代码仓库或完整原始文档。
- 不处理图片、音频和视频。
- 不承诺 OpenWiki 推理必然离线；只有明确配置本地 OpenAI-compatible 服务时才能声明模型推理不离开本机。
- 不引入第二套审核、发布或权限系统。
- 不引入 Graphify、Docling、RAGFlow 或完整向量数据库平台。
- 不做超过 10 MiB 的分片和断点续传。
