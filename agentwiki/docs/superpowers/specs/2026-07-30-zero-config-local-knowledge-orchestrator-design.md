# 零配置本地知识编排与双向同步设计

## 背景

现有 `@neomei/agentwiki-local-sync` 使用 OpenWiki 把本地代码或文档整理为 OKF，再同步到 AgentWiki。真实验证发现 OpenWiki 过重：需要交互式初始化、独立模型配置和较长运行时间，并且容易因 provider、MCP timeout 或子进程退出失败而中断。

OpenWiki 不再作为本地知识同步的必需组件。本设计用 AgentWiki Local Knowledge Orchestrator 取代其职责，并保留已经验证有效的安全边界：所有原始材料和整理过程留在本地，只有整理后的共享知识在用户确认后进入 AgentWiki。

## 目标

- 用户只需把 AgentWiki 生成的一次性接入指令交给本地 Agent。
- 不要求用户配置 OpenWiki、模型 Provider、额外 API Key、MCP JSON、本地端口或后台服务。
- codebase-memory、MarkItDown 和未来的 agent-memory 作为同等地位的 Source Adapter。
- 当前本地 Agent 使用自己已有的模型能力完成语义理解和知识组织。
- Orchestrator 通过确定性状态机、Recipe、Schema、证据和 checkpoint 保证不同 Agent 稳定执行。
- 同一 Space 共享一套统一 Wiki；多种 Adapter 只作为来源和证据。
- AgentWiki 服务端是 Space 知识的权威版本库，本地是可编辑、可恢复、适合 Agent 高频读取的文件副本。
- 支持双向增量同步、跨机器恢复和 base/local/remote 三方冲突合并。

## 已确认决策

1. 所有采集、转换、整理、合并和敏感信息检查均在本地执行。
2. 原始代码仓库、原始二进制文档、原始 Agent Memory 数据库和本地凭据不上传。
3. 可以上传完整的可迁移知识产物，不以“短摘录”作为边界；边界取决于内容是否已经整理为可共享知识。
4. AgentWiki 服务端只接收整理后的页面、共享记忆、关系、来源记录、证据、删除提案和版本信息。
5. 本地 Agent 是语义整理执行者；Orchestrator 不内嵌第二套模型。
6. 采用“确定性控制层 + Agent 认知能力”，不能只依赖自然语言 Skill。
7. Adapter 输出统一 SourceArtifact，不能直接修改 Wiki 或调用同步。
8. 同一 Space 只有一套统一 Wiki，多 Adapter 来源在同一知识项上保留 provenance。
9. AgentWiki 服务端为权威 Revision，本地为可编辑缓存和工作副本。
10. 同一知识字段并发修改时，本地 Agent 生成三方合并提案，用户预览确认后提交。
11. 安装采用一个接入指令和私有运行时按需安装 Adapter；不要求用户手工安装依赖。
12. 不运行本地端口或常驻 daemon；正常入口是本地 Agent 的自然语言操作。

## 总体架构

```text
Source Adapters
  codebase-memory | MarkItDown | agent-memory | future adapters
                         │
                         ▼
                 SourceArtifact batches
                         │
                         ▼
Local Knowledge Orchestrator
  state machine + recipes + schemas + provenance + checkpoints
                         │
                         ▼
Space Local Workspace
  unified wiki + base snapshot + drafts + sync manifest
                         │
             preview + explicit confirmation
                         │
                         ▼
AgentWiki Space Revision Store
  validate + ChangeSet + review/policy + publish + deltas
                         │
                         ▼
           pull and materialize on other Agents
```

### 1. Source Adapter

每个 Adapter 只负责从一种本地来源产生标准化 Artifact：

- codebase-memory：架构、模块、符号、依赖、调用关系和变更影响。
- MarkItDown：把 PDF、DOCX 等转换为本地可整理 Markdown，并保留文档定位。
- agent-memory：未来输出可共享的决策、经验、偏好和事实，不直接暴露原始记忆数据库。
- 后续 Adapter：通过同一协议接入，不修改 Orchestrator 和同步核心。

### 2. Local Knowledge Orchestrator

Orchestrator 控制任务阶段、Adapter 生命周期、工作项、Schema、稳定 ID、证据、校验、预览、冲突和同步。它不调用独立模型，而是把有限、结构化的语义工作项交给当前本地 Agent。

### 3. Space Local Workspace

本地以 Space 为隔离边界：

```text
~/.agentwiki/spaces/<space-id>/
├── wiki/
│   ├── pages/
│   ├── memories/
│   └── relations.json
└── .state/
    ├── manifest.json
    ├── provenance.json
    ├── base/
    ├── drafts/
    └── checkpoints/
```

Agent 直接读取 `wiki/` 下的 Markdown/JSON。`.state/` 只供 Orchestrator 使用，不作为知识内容展示。

### 4. Sync Engine

Sync Engine 从服务端获取 Snapshot 或 Delta，原子物化本地 Wiki；本地知识修改通过 Knowledge ChangeSet 推送。同步核心不依赖任何具体 Adapter。

## Adapter 协议

```ts
interface SourceAdapter {
  manifest(): AdapterManifest;
  inspect(input: AdapterInput): Promise<SourceDescriptor>;
  collect(input: AdapterInput, cursor?: string): Promise<ArtifactBatch>;
}

interface AdapterManifest {
  adapterId: string;
  version: string;
  protocolVersion: string;
  inputKinds: string[];
  artifactKinds: string[];
  supportsIncremental: boolean;
  permissions: LocalPermission[];
  runtime: ManagedRuntimeDescriptor;
}
```

Adapter 不能拥有以下能力：

- 直接写入 `wiki/`；
- 直接上传 AgentWiki；
- 读取未授权目录；
- 绕过敏感信息分类；
- 静默安装全局依赖；
- 自行决定删除或发布。

## SourceArtifact

```ts
interface SourceArtifact {
  artifactId: string;
  adapterId: string;
  adapterVersion: string;
  sourceId: string;
  logicalKey: string;
  contentHash: string;
  updatedAt: string;
  kind: 'code' | 'document' | 'memory' | 'relation';
  content: StructuredKnowledge;
  evidence: EvidenceReference[];
  sensitivity: 'shareable' | 'review-required' | 'local-only';
}
```

规则：

- `artifactId`、`sourceId` 和 `logicalKey` 跨机器保持稳定。
- `contentHash` 基于规范化内容计算。
- `local-only` 永远不能进入可上传 Bundle。
- `review-required` 必须在预览中单独显示。
- Adapter 只输出已经本地处理的 Artifact，不把原始文件打包上传。
- 内容长度不是上传边界；是否属于可迁移知识产物才是边界。

## KnowledgeBundle

```ts
interface KnowledgeBundle {
  schemaVersion: string;
  recipeVersion: string;
  spaceId: string;
  baseRevision: string;
  pages: WikiPage[];
  memories: SharedMemory[];
  relations: KnowledgeRelation[];
  provenance: ProvenanceRecord[];
  deletions: DeletionProposal[];
}
```

稳定性规则：

- 页面 ID 不依赖标题，重命名不产生新页面。
- 同一主题可引用多个 Adapter 的 Artifact。
- 页面、记忆和关系必须能追溯到 Artifact。
- 顺序、路径、hash、时间格式和空值表达统一规范化。
- 删除只产生 tombstone proposal，不能直接物理删除远端知识。
- Adapter 或 Recipe 版本变化必须生成迁移预览。

## Orchestrator 状态机

```text
DISCOVER
  → COLLECT
  → ORGANIZE
  → VALIDATE
  → PREVIEW
  → CONFIRM
  → PUSH
  → PULL/MATERIALIZE
```

状态保存在本地 checkpoint 中，不依赖 Agent 对话上下文。

### MCP 工具

```text
start_knowledge_job
get_next_work_item
read_artifacts
submit_organized_item
validate_knowledge_job
preview_knowledge_job
confirm_and_push
pull_space
resolve_conflict
```

每次 `get_next_work_item` 只返回一个有限任务。Agent 不能自行跳过阶段，也不能在没有有效 job state 时直接调用 Push。

### Agent 与 Orchestrator 的职责边界

Agent 负责：

- 理解 Artifact；
- 归纳页面正文、共享记忆和关系候选；
- 对语义冲突提出合并内容；
- 根据结构化 validation issue 修复指定知识项。

Orchestrator 负责：

- 页面 ID、路径、顺序和 hash；
- Recipe、Schema 和状态迁移；
- 工作项拆分和上下文预算；
- provenance 和 sensitivity；
- 增量 diff、checkpoint、预览和同步；
- 重试次数、超时和幂等。

## 版本化 Recipe

Recipe 固定同类任务的行为模式，例如：

- `code-wiki@1`：系统概览、入口、模块、数据流、依赖、运行与术语。
- `document-library@1`：目录、主题、关键事实、引用与关联页面。
- `agent-memory@1`：决策、经验、偏好、适用范围、失效条件和时间属性。
- `space-reconcile@1`：多来源主题合并、页面更新和关系修复。
- `three-way-merge@1`：base/local/remote 冲突合并。

Recipe 定义：

- 需要的 Artifact 类型；
- 必填页面/字段；
- 工作项切分策略；
- 证据最低要求；
- 主题身份与合并规则；
- 删除策略；
- 质量门禁；
- 最大修复次数。

## 确定性校验

`validate_knowledge_job` 至少检查：

- JSON Schema；
- 页面和关系稳定 ID；
- provenance 覆盖；
- 无来源结论；
- 重复主题；
- 断链和循环目录；
- 敏感信息；
- `local-only` 泄露；
- 删除范围；
- 内容和 Bundle 大小；
- base revision；
- Adapter、Recipe、Schema 版本兼容性。

错误使用结构化 issue 返回：

```ts
interface ValidationIssue {
  itemId: string;
  rule: string;
  artifactIds: string[];
  repairable: boolean;
  message: string;
}
```

只重做失败知识项。达到 Recipe 规定的修复次数后停止并报告，不能无限调用 Agent。

## 安装与调用体验

用户只需要：

1. 在 AgentWiki 选择 Agent、Space 和权限；
2. 生成一次性接入指令；
3. 把整段指令交给本地 Agent。

本地 Agent 自动完成：

- 安装精确版本；
- 注册 stdio MCP 和版本化 Skill；
- 交换一次性安装码；
- 创建 Space Workspace；
- 拉取现有 Space Wiki；
- 检测或按需安装 Adapter；
- 运行 doctor；
- 报告接入结果。

日常入口是自然语言：

```text
把当前项目整理到“产品研发”Space。
把这个文档目录整理进当前 Space。
同步当前 Space 的最新知识。
拉取团队最新共享记忆。
```

用户不需要理解 OpenWiki、Provider、Space ID、preview ID、MCP JSON、CLI 内部命令或本地端口。

## 私有运行时与 Adapter Manager

```text
~/.agentwiki/runtime/
├── adapters/
├── bin/
├── python/
├── cache/
└── runtime-lock.json
```

安装策略：

- 优先复用兼容的已有安装。
- 缺失时按需安装到私有运行目录，不修改全局环境。
- codebase-memory 使用非交互 CLI/MCP 接口。
- MarkItDown 使用固定版本的私有 Python 环境。
- Adapter manifest 固定版本、来源和校验哈希。
- 只安装当前任务需要的 Adapter。
- 升级先并行安装新版本，验证后原子切换；失败回滚。
- 不运行交互式 init。
- 基础组件只运行 stdio MCP，不开放端口，不增加 daemon。

## 双向同步

### Pull

1. 查询 Space 当前 Revision。
2. 请求 `lastPulledRevision → currentRevision` Delta；首次连接下载 Snapshot。
3. 校验 Schema、hash 和授权。
4. 写入临时目录。
5. 完整校验后原子物化 `wiki/`。
6. 更新 manifest、base snapshot 和 provenance。

### Push

1. 强制执行 Pull。
2. 计算 base/local/remote 三方差异。
3. 确定性合并非冲突项。
4. 对冲突项创建 ConflictBundle。
5. 完成本地 validation 和 preview。
6. 当前对话明确确认。
7. 上传 KnowledgeBundle，生成 AgentWiki ChangeSet。
8. 审核或 Space 策略发布后返回新 Revision。
9. 本地拉取并物化正式 Revision。

## 冲突处理

```ts
interface ConflictBundle {
  itemId: string;
  base: KnowledgeItem | null;
  local: KnowledgeItem | null;
  remote: KnowledgeItem | null;
  provenance: ProvenanceRecord[];
  conflictingFields: string[];
}
```

- 本地独有修改进入提案。
- 远端独有修改自动拉取。
- 不同知识项确定性合并。
- 同一知识项不同字段按字段合并。
- 同一字段同时修改时，本地 Agent 按 `three-way-merge` Recipe 生成合并提案。
- 删除/修改冲突必须单独显示。
- Agent 不能自行选择 local 或 remote 获胜。
- 合并提案重新通过 Schema、provenance 和敏感信息检查。
- 用户预览确认后才提交。

## 服务端职责

AgentWiki 服务端只负责：

- Space 权限和 Credential 校验；
- KnowledgeBundle Schema、hash、Revision 和幂等校验；
- Source、Run、Evidence、ChangeSet 和审核记录；
- Space Revision、Snapshot 和 Delta；
- 发布策略、审计、回滚和跨 Agent 分发。

服务端不负责：

- 读取本地目录；
- 调用 Source Adapter；
- 运行模型整理原始材料；
- 接收原始代码仓库或原始 Memory 数据库；
- 替 Agent 解决语义冲突。

权限仍为：

```text
Credential Scope ∩ Space Grant ∩ Space Policy
```

失去 Space 权限后停止 Pull/Push；用户可选择保留或清理本地副本。

## 运行隔离与故障恢复

- Adapter 在独立子进程中运行，只获得任务需要的目录。
- 中间产物写入临时目录，不修改原始项目。
- 设置时间、内存、文件数和输出大小限制。
- 取消或超时后终止整个进程组，不能遗留孤儿进程。
- stdout 只传协议数据，stderr 保存脱敏诊断。
- Adapter 安装或运行失败只影响对应来源。
- 单文件失败记录 skipped item，其余内容继续。
- Agent 中断后从 work item checkpoint 恢复。
- 网络中断时本地整理继续，Push 保持 pending。
- Pull 中断时继续使用上一个完整 Revision。
- 缓存损坏时从服务端 Snapshot 重新物化。
- 权限被撤销时停止同步并废弃当前任务授权。
- Adapter、Recipe 或 Schema 升级先生成迁移预览。
- 连续失败后熔断，不能无限自动重试。

## 安全与隐私

- 原始材料只在用户指定的本地范围内处理。
- API Key 不进入命令参数、项目目录、MCP 配置、日志或 Bundle。
- 本地 Credential、checkpoint 和 private runtime 使用 owner-only 权限。
- 所有可上传内容通过秘密扫描和 sensitivity gate。
- `review-required` 在预览中明确列出。
- 上传前显示 Space、页面、记忆、关系、删除、大小和来源摘要。
- Adapter 包使用固定版本、可信来源和完整性校验。
- 任何远程处理能力未来若被引入，必须是独立可选 Adapter，并在调用前取得单独数据边界同意。

## 测试策略

### Contract 测试

- 每个 Adapter 使用同一套 manifest、inspect、collect 合规测试。
- Artifact 和 Bundle 使用 golden fixtures 验证规范化、稳定 ID 和 hash。
- 未知字段、版本不兼容和 `local-only` 泄露必须 fail closed。

### Recipe 稳定性测试

- 使用同一 fixture 分别驱动 Codex、Claude Code 和 OpenCode。
- 允许正文措辞不同，但页面 ID、目录、必填字段、关系类型和来源覆盖必须一致。
- validation issue 必须只重做失败项。
- 达到最大修复次数后必须停止。

### Adapter Runtime 测试

- 已安装复用、缺失安装、校验失败、升级回滚、离线失败和卸载。
- 子进程 timeout/cancel 必须回收整个进程组。
- 原始目录保持只读且无新增文件。

### 双向同步测试

- 新机器完整 Snapshot 恢复。
- 两台机器增量 Pull/Push。
- 非冲突字段自动合并。
- 同字段冲突生成 ConflictBundle。
- 删除 tombstone 不被离线节点复活。
- 过期 baseRevision 和权限撤销 fail closed。

### 隐私与安全测试

- 源码、二进制原文、原始 Memory DB 和 Credential 不进入 Bundle。
- 敏感信息扫描覆盖源码、Artifact、Draft、Preview 和日志。
- `local-only` 和未确认的 `review-required` 不上传。

### 真实端到端验收

1. 一个接入指令完成 Codex、Claude Code、OpenCode 安装。
2. codebase-memory 生成代码知识并同步。
3. MarkItDown 生成文档知识并同步。
4. 新机器拉取统一 Space Wiki，并直接读取本地文件。
5. 两台机器制造冲突，完成三方合并预览与发布。
6. 网络、Adapter、Agent 和服务端分别中断后可恢复。
7. 全流程确认没有上传原始文件或秘密。

## 迁移与发布策略

现有 `0.1.1` 仍包含 OpenWiki 路径，不能把它宣传成零配置 Orchestrator。新协议属于架构变更，建议以 `0.2.0` 发布。

分阶段实施：

1. 定义 Adapter、Artifact、KnowledgeBundle、Recipe、Job State 和 Revision/Delta 协议。
2. 实现本地 Workspace、确定性校验和状态机，不接同步。
3. 实现 codebase-memory Adapter 和统一 Wiki 生成。
4. 实现 MarkItDown 私有运行时 Adapter。
5. 实现服务端 Revision、Snapshot、Delta 和双向同步。
6. 实现冲突检测、三方合并和用户预览。
7. 完成跨 Agent、跨机器真实 E2E。
8. 发布 `0.2.0`，更新 AgentWiki 生成指令和使用指南。
9. 后续按同一协议加入 agent-memory Adapter。

升级原则：

- `0.1.x` 连接不自动切换到 `0.2.0`。
- 升级先迁移本地配置和 Space Workspace，再切换 MCP 命令。
- 旧 OpenWiki preview 不作为新 Bundle 直接上传；需要通过迁移 Recipe 重新整理。
- 服务端在迁移窗口内明确区分 OKF v0.1 与 KnowledgeBundle 新协议。
- `0.2.0` 验证完成前，使用指南不能声称新方案已可用。

## 不做

- 不把 AgentWiki 服务端变成本地文件处理器。
- 不在 Orchestrator 内嵌新的 LLM 或统一模型 Key。
- 不支持 Adapter 直接发布正式内容。
- 不使用 last-write-wins 覆盖冲突。
- 不使用只靠提示词约束的自由流程。
- 不在第一阶段增加后台 daemon、文件实时监听或 P2P/CRDT 多主同步。
- 不把每个 Adapter 展示成独立 Wiki。
- 不上传原始代码库、原始文件或原始 Agent Memory 数据库。
