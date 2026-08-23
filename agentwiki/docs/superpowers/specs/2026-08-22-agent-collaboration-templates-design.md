# Agent 协作模板与组件设计

日期：2026-08-22
状态：已确认（2026-08-22 完整性修订）
选定方案：AgentWiki 协作控制面 + 外部 Agent MCP 执行面

## 背景

AgentWiki 已经具备 Space、Agent 独立身份、Credential、Space Grant、MCP、人工审核、审计，以及本地知识编排器中的确定性 Recipe、WorkItem、checkpoint、租约和幂等经验，但还没有面向用户的通用多 Agent 协作工作流。

用户希望从编码、标书、论文、视频脚本和小说等内置模板出发，选择当前 Space 中的 Agent，调整任务、Todo、依赖和审核点，启动一次可观察、可恢复的协作运行。外部 Codex、Claude Code、OpenCode 或其他 MCP Agent 负责实际执行；AgentWiki 不托管模型，也不直接远程唤醒本地 Agent。

## 目标

- 提供编码协作、标书撰写、论文撰写、视频脚本撰写和小说撰写五类只读内置模板。
- 用户复制内置模板后，可以配置角色槽位、Agent 任务、顺序 Todo、依赖/并行、人工审核和结果交接/汇总。
- 启动运行时把角色槽位映射为当前 Space 中的具体 Agent，并冻结模板快照。
- 每个参与 Agent 只需在流程开始或人工审核恢复后被用户唤醒一次，即可持续领取自己的任务、执行 Todo、回传结果和等待下一动作。
- AgentWiki 保存 Markdown、结构化结果、版本、证据和外部引用；代码仓库、DOCX/PDF 等文件继续由外部 Agent 在本地或外部系统生成。
- 使用租约、心跳、幂等、自动重试、人工改派和审计保证中断后可恢复。
- 人工审核始终由授权人类成员完成，Agent 不能批准自己的产物或任何其他产物。

## 成功标准

1. 用户可以从五个内置模板复制一个 Space 模板，通过表单完成配置和确定性校验。
2. 用户可以在三步启动向导中填写运行输入、完成角色映射并启动运行。
3. 两个以上外部 Agent 可以在同一运行中并行领取互不依赖的任务，且不会重复领取或重复提交。
4. 同一 Agent 可以按 Todo 顺序完成多个任务，直到运行终态或人工审核点。
5. 人工审核可以通过、驳回修改或终止；驳回保留旧产物并产生新的修订尝试。
6. Agent 离线、租约过期、重复请求、撤权和重试耗尽均有确定、可审计的结果。
7. 运行看板能显示阶段、当前任务、Todo、Agent 状态、租约、审核、产物和事件时间线。
8. 编码与标书模板通过真实多 Agent 端到端验收，其余模板通过结构契约和代表性运行测试。

## 已确认决策

1. 执行模式采用外部 Agent 主动通过 MCP 加入、领取和回传，不采用服务端托管模型。
2. MVP 提供内置模板复制配置，不提供从空白开始的通用拖拽流程编辑器。
3. Agent 在一次执行会话中持续工作，直到流程结束、人工审核点或需要人工处理的暂停状态。
4. AgentWiki 保存协作产物、上下文和证据；外部文件只保存受控引用，不建设通用文件仓库。
5. MVP 只有五类核心组件：Agent 任务、顺序 Todo、依赖/并行、人工审核、结果交接/汇总。
6. 模板定义角色槽位，启动时再映射具体 Agent；一个 Agent 可承担多个槽位，但每个运行任务只有一个主责 Agent。
7. 人工审核只允许人类完成。
8. Agent 失败采用租约、自动重试和人工接管；不做动态能力竞领或自动改派。
9. 选择独立协作控制面并复用现有确定性编排经验，不把 Local Knowledge Orchestrator 扩成通用多 Agent 引擎。

## 与 Agent 统一访问角色的关系

本设计依赖的 `reader | editor | publisher` Agent 统一访问角色已经随 local-sync/onboarding `0.5.1` 发布并完成生产验证。协作实现直接复用该单一角色事实，不再把角色改造作为待完成的中间门禁。协作能力完成后，把 local-sync、server/client 应用包、统一网关、服务端 onboarding 兼容声明和用户指令统一提升到 `0.6.0`。`@neomei/agentwiki-sync-protocol` 同步包含新契约，但保持其独立包版本策略，不把它的包版本强行等同于 local-sync 协议版本。

普通界面继续只显示和提交访问角色，不能重新暴露逐项 scope 配置。协作能力只扩展统一角色策略的底层派生 scopes：

| Agent 访问角色 | 新增协作 scopes | 协作能力 |
|---|---|---|
| `reader` | `collaboration:read` | 查看获授权运行摘要，不能领取任务 |
| `editor` | `collaboration:read`、`collaboration:execute` | 查看运行并领取、执行、提交任务 |
| `publisher` | 与 `editor` 相同 | 协作执行能力不因发布角色额外放宽 |

协作 scopes 必须加入 `@neomei/agentwiki-sync-protocol` 的唯一角色策略，并只从 Credential 所绑定的当前 AgentGrant 角色派生。有效权限是连接/Agent 状态、Space Grant 角色、Space Policy 和协作领域授权的交集。任何角色仍不包含 `review:decide`。

“Agent 访问角色”表示 Agent 在 Space 中的权限上限；“协作角色槽位”表示某个模板中的职责。两者不得混用。

## 选定架构

```text
Template Library + Template Configuration + Run Dashboard
                            │
                            ▼
           AgentWiki Collaboration Control Plane
 template snapshot | dependencies | tasks | leases | reviews | events
                            │
             unified AgentWiki MCP collaboration tools
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
          External       External       External
           Agent A        Agent B        Agent C
              │             │             │
              └──────── Task Artifacts ───┘
                            │
          Markdown / JSON / evidence / external references
                            │
                  optional Wiki publication
```

### AgentWiki 协作控制面

服务端拥有系统/Space 模板、运行快照、输入变量、角色绑定、任务、Todo、依赖、尝试、租约、重试、产物版本、人工审核和事件时间线的权威状态。控制面只推进确定性状态，不运行模型、不读取本地仓库、不打开本地文件，也不代表 Agent 执行认知任务。

API 进程处理人类操作和 MCP 的同步事务；现有 Worker 进程负责扫描过期租约、释放可重试任务和推进到期的 `retry_wait`。状态先提交 PostgreSQL，再通过现有 Socket.io collaboration gateway 发送尽力而为的实时通知；通知不是权威记录，客户端断线重连后必须重新获取运行状态。

### 外部 Agent 执行面

外部 Agent 通过现有统一 `agentwiki` MCP gateway，以当前 AgentCredential 身份加入运行，领取映射给自己的就绪任务，读取任务显式声明的输入和已接受产物，按顺序执行 Todo，发送心跳，并提交 Markdown、JSON、证据或外部引用。

### 与 Local Knowledge Orchestrator 的边界

现有 Local Knowledge Orchestrator 继续负责本地知识采集、组织、预览和同步，不承载通用多 Agent 协作。协作模块复用确定性状态机、Schema、有限工作项、重试预算、checkpoint、幂等键、证据、租约和迟到结果拒绝等经验。

不得直接复用知识 Recipe 的 `code | document | memory | relation` Artifact 约束，也不得把协作模板命名为 Recipe。

## 领域模型

### Collaboration Template

可复用、版本化的协作蓝图，包含输入变量、角色槽位、节点、Todo、依赖、输出契约和审核规则。

- 系统模板有稳定 slug、由版本化 seed 管理、只读。
- “复制为我的模板”在当前 Space 创建独立副本。
- 用户副本修改不会影响系统模板或其他副本。
- 每次有效保存递增模板版本号。
- 启动运行时保存完整不可变快照；之后编辑模板不改变已有运行。

### Collaboration Component

模板编辑器中的用户可见构建块。组件在运行时解析为任务节点、人工审核节点、依赖边或任务内 Todo；它本身不一定是可领取对象。

### Role Slot 与 Role Binding

- Role Slot 是模板中的职责，例如规划者、实现者、审校者。
- Role Binding 是运行中 Role Slot 到具体 Agent 的映射。
- 一个 Agent 可以绑定多个 Role Slot。
- 启动预检要求每个必需 Role Slot 都绑定当前 Space 中 active 且访问角色至少为 `editor` 的 Agent。
- 人工改派只改变指定 Run Task 的当前负责人，不篡改模板快照和不可变 Role Binding 快照；事件记录原负责人、新负责人和理由。
- Agent 可以加入运行，当且仅当它仍满足 active、Space Grant、Credential 与 `collaboration:execute` 交集，并且“存在于 Role Binding”或“当前负责至少一个非终态 Run Task”。因此合法改派后的新 Agent 可以加入，旧 Agent 在不再绑定任何槽位且不再负责非终态任务时不能继续执行。
- 改派事务必须重新校验新 Agent 权限、废止旧负责人的活跃尝试、更新任务负责人并生成一条合并恢复指令；只改 `assigneeAgentId` 而不处理租约和加入资格不算完成。

### Collaboration Run

从模板快照和角色绑定创建的一次 Space 级执行。运行属于且只属于一个 Space。

```text
draft → ready → running
                 ├→ waiting_review → running
                 ├→ paused → running
                 ├→ completed
                 ├→ failed
                 └→ cancelled
```

- `draft`：已创建但输入或角色映射未完成。
- `ready`：模板、输入、角色和权限预检通过。
- `running`：至少存在可推进的运行节点。
- `waiting_review`：当前唯一可推进动作是人类审核。
- `paused`：需要人类修复输入、重试、改派或处理撤权。
- `completed`：所有必需终点完成。
- `failed`：运行已 paused 且没有被接受的恢复方案，由 Owner/Admin 带理由“结束为失败”；自动重试耗尽本身只会暂停，不会静默结束运行。
- `cancelled`：Owner/Admin 在成功前主动终止。`completed`、`failed`、`cancelled` 都是终态。

运行状态由服务端在每次事务提交前按固定优先级重算，客户端不得自行推导：显式终态保持不变；人工暂停/授权失效/重试耗尽为 `paused`；只要存在 `ready | claimed | running | retry_wait` 的 Agent 任务即为 `running`；不存在这些任务且存在可处理的 pending Review 才为 `waiting_review`；全部必需任务和终点满足后才为 `completed`。因此“同时有待审核节点和另一条可执行并行分支”必须保持 `running`，不能过早进入 `waiting_review`。

### Run Task

唯一可被 Agent 领取的执行单位，一个任务同时只有一个主责 Agent 和一个有效尝试。

```text
blocked → ready → claimed → running → submitted → completed
                                  └→ retry_wait → ready
                                  └→ failed
                                  └→ skipped
```

`blocked` 表示依赖未满足；`ready` 可领取；`claimed` 已签发租约；`running` 至少一个 Todo 已开始；`submitted` 等待校验或人工审核；`completed` 的结果已接受；`retry_wait` 等待退避；`failed` 使运行暂停；`skipped` 由授权人类带理由跳过。每个 Run Task 维护从 1 开始的 `generation`；Todo、Attempt、Artifact 和 Review 都记录对应 generation，权威读取只使用任务当前 generation，旧代记录永不覆盖或删除。

### Task Todo

Run Task 内部有序、不可独立领取的检查项。它继承任务负责人、generation 和租约，可标记必做或可选；后一项不能越过未完成的必做前项。每项保存状态、简短结果和可选证据引用。Agent 任务必须至少有一个 Todo 且至少一个必做 Todo。将 Todo 标为 `failed` 会原子结束当前 Attempt；若基础设施重试预算尚有剩余则任务进入 `retry_wait`，否则运行进入 `paused`，不能留下“Todo 已失败但 Attempt 仍可提交”的矛盾状态。

### Task Dependency

节点之间的前置关系，而不是运行任务。支持 `all`（所有上游完成）和 `any`（任一上游完成）。`any` 采用“提前释放”而不是“赢家通吃”：任一上游满足即可释放下游，但其余未跳过上游仍必须完成，运行才可完成。下游只能读取当前已接受且显式声明为可选的上游产物；若输入契约把某个上游产物声明为必需，校验器必须拒绝可能在该产物尚未产生时提前释放的 `any` 配置。模板保存时拒绝循环依赖、不存在节点、无入口、无终点和不可达必需节点。多个无相互依赖且同时 ready 的任务自然并行。

### Task Artifact

Run Task 提交的版本化结果，类型为 Markdown、受 Schema 限制的 JSON、外部代码/文件引用或证据摘要。每次提交创建新版本，不覆盖旧版本。

若任务不要求人工接受，服务端 Schema 和证据校验通过后版本即被接受；若任务连接 Human Review Gate，产物保持 pending，只有审核通过后成为下游可读取的 accepted 版本。Artifact 状态包含 `pending | accepted | rejected | superseded`；任何依赖读取必须同时匹配任务当前 generation 和 `accepted`，避免驳回后继续消费旧产物。

外部引用包含类型、显示名称、可选版本/commit、内容 hash 和受控 URI。`workspace_path` 输入只接受 POSIX 相对路径，并拒绝绝对路径、独立 `..` 路径段、反斜杠、Windows drive/UNC、NUL；保存时去除空段和 `.` 段得到规范形式。`url` 只能是可解析的 HTTPS，拒绝 credentials 和 `token`、`key`、`signature`、`sig`、`x-amz-*`、`x-goog-*` 等凭据型查询参数，保存前移除 fragment；URL 与 workspace path 必须带内容 hash。`git_commit` 必须带仓库显示引用和完整 40 或 64 位十六进制提交值。服务端只验证和保存引用，绝不抓取 URL、打开路径或验证仓库内容。外部引用不会自动发布为 Wiki 正文。

### Human Review Gate

只能由授权人类成员执行的节点：

- `approve`：接受指定产物并释放下游；
- `reject_for_revision`：填写意见并指向合法返回任务，创建新的内容修订尝试；
- `terminate`：终止运行、废止活跃租约并保留历史。

Agent 审校任务仍只是 Run Task，只能提交建议，不能替代 Human Review Gate。

Review 状态包含 `pending | approved | rejected | terminated | superseded`。`reject_for_revision` 先把当前决策行记为 `rejected`，再在同一串行化事务中执行代际失效：校验返回任务是审核来源任务的合法祖先或来源任务本身；计算从返回任务到该 Review 及其所有下游的受影响子图；废止其中活跃 Attempt；把受影响任务的当前 generation 加一；把旧代 pending/accepted Artifact 和除当前决策行外的 pending Review 标为 `superseded`；为新代创建初始 Todo；将返回任务按其外部依赖重算为 `ready | blocked`，其后代先置为 `blocked`；最后重算运行状态并记录包含受影响节点集合的事件。旧 Todo、Attempt、Artifact、Review 和事件保留用于审计，但不得参与新代依赖判断或完成判定。

## 五个核心组件

### 1. Agent 任务

配置名称、目标、说明、主责 Role Slot、输入变量、上游产物、输出 Schema、必需证据、人工接受、Todo、租约、最大执行时限、重试、修复预算和是否允许人类跳过。完成条件为全部必做 Todo 完成，产物通过大小、Schema、证据、路径和权限校验，并在需要时通过人工审核。

### 2. 顺序 Todo

配置名称、说明、必做/可选、期望简短结果和证据类型。Todo 只能在所属任务内排序，不拥有独立 Agent、依赖或租约。

### 3. 依赖与并行

编辑器提供依赖选择器和 `all | any` 条件。并行只是多个节点同时 ready 的运行结果，不引入“并行组执行器”。

### 4. 人工审核点

配置审核对象、指定用户或最低 Space 人类角色、通过标准、驳回返回任务和终止权限。模板不得指定 Agent 为审核人。

### 5. 结果交接与汇总

简单交接只把已接受 Task Artifact 的引用注入下游显式输入。需要重写、合并或生成最终稿时，创建一个消费多个上游产物的 Agent 汇总任务；不引入独立的“复制上下文”任务。

## 模板与产物契约

- `inputs`、`roleSlots`、`nodes`、每个任务的 Todo 和输出 key 在各自作用域内唯一；所有 Role Slot、节点、终点和依赖引用必须存在。
- Agent 任务显式声明 `upstreamArtifacts: [{ key, required }]`。引用的 Artifact key 必须由可达上游任务产生；Human Review 的 `artifactTaskId` 必须指向有边到该 Review 的 Agent 任务，`revisionTaskId` 必须是其合法祖先或自身。
- terminal 节点必须存在、唯一且无出边；所有必需节点可从入口到达。循环、孤儿、悬空引用、非法 `any + required artifact` 和非法审核返回目标均在保存与启动时拒绝。
- `roleSlots` 在共享 DTO 中始终是对象数组，不允许服务端、MCP 和前端各自退化为字符串数组。
- Artifact 使用按 `kind` 判别的严格联合：Markdown 为 `{ kind, markdown, evidence }`，JSON 为 `{ kind, json, evidence }`，外部引用为 `{ kind, externalReference, evidence }`，证据摘要为 `{ kind, summary, evidence }`；未知字段拒绝。
- JSON 输出采用受限 JSON Schema 2020-12 子集：仅支持 `type`、`properties`、`required`、`additionalProperties`、`items`、`enum`、`const`、长度/数值/数组上下限；拒绝 `$ref`、`$dynamicRef`、远程加载、未列出的关键字和超深 Schema。服务端使用直接依赖且锁定版本的 Ajv，开启 strict/allErrors、禁止远程解析，并按 Schema hash 做有上限缓存。
- 启动输入必须按模板变量类型再次校验，不能只检查必填和 URL/number 的前端表单状态；所有 MCP 服务端输出也必须通过共享输出 Schema 后才返回。

## 五类内置模板

### 编码协作

- Role Slots：需求/架构规划者、实现者、测试者、代码审查者、发布负责人。
- 流程：需求与影响分析 → 方案/测试计划 → 按模块并行实现 → 测试与 Agent 审查 → 缺陷修复循环 → 人工合并/发布审核。
- 产物：实施计划、补丁或 commit 引用、测试证据、审查报告、发布说明。
- 约束：AgentWiki 不直接修改或托管仓库；发布仍需要独立授权。

### 标书撰写

- Role Slots：招标分析者、素材管理员、方案架构师、分章撰写者、合规审校者、终稿编辑。
- 流程：招标文件与评分矩阵 → 素材入库 → 应标共识人工门 → 大纲/矩阵机器校验 → 分章并行写作 → 缺口补料人工门 → 图文和覆盖度检查 → 合并润色 → 终稿人工门 → DOCX/PDF 外部导出引用。
- 产物：评分矩阵、大纲、章节稿、缺口清单、配图引用、合并稿、验收清单和导出文件引用。
- 约束：人工门仅用于应标共识、缺口补料和终稿审定；评分覆盖、大纲映射、图文对应和合并稿一致性由任务 Todo 自动核查。商务标只提示格式检查，不自动填报。

### 论文撰写

- Role Slots：研究规划者、文献研究者、方法/数据分析者、章节作者、引文核验者、学术编辑。
- 流程：研究问题与范围 → 人工确认提纲 → 文献/方法并行 → 章节起草 → 引文真实性、方法一致性和论证检查 → 修改 → 人工终稿审核。
- 产物：研究提纲、来源清单、方法说明、章节稿、引文核验报告、最终 Markdown 和外部 DOCX/LaTeX 引用。
- 约束：禁止编造来源、引用、数据、实验或统计结论；无法验证的条目必须显式标记。

### 视频脚本撰写

- Role Slots：内容策划、事实研究者、脚本作者、分镜设计者、品牌/事实审校者。
- 流程：平台/受众/时长 → 资料与事实清单 → Hook 和叙事结构 → 口播稿与分镜并行细化 → 时长、事实和品牌语气检查 → 人工成片前审核。
- 产物：创意简报、事实卡、时间轴脚本、镜头/字幕/B-roll 表、审校报告和最终脚本。

### 小说撰写

- Role Slots：世界观设计者、情节架构师、章节作者、连续性编辑、文风编辑。
- 流程：题材/受众/篇幅 → 世界观与人物圣经 → 故事大纲人工门 → 按依赖顺序写章节 → 连续性与伏笔核对 → 文风润色 → 人工终稿审核。
- 产物：世界观、人物卡、时间线、章节大纲、章节版本、连续性报告和完整稿。
- 约束：默认不并行撰写相互依赖章节；只有明确无连续性依赖的章节或辅助研究可以并行。

## 模板存储与运行展开

MVP 采用“模板定义 JSON + 运行规范化记录”：

- `CollaborationTemplate` 保存系统/Space 所属、稳定 slug、版本和当前受 Schema 校验的定义 JSON。
- 系统模板通过稳定 seed 版本更新，前端不能编辑。seed 定义先经 Schema parse 生成不可变深拷贝；事务只在数据库 `seedVersion < incomingSeedVersion` 时更新，同版本幂等、旧版本永不降级，多副本并发也不能覆盖较新 seed；Space 副本永不跟随更新。
- Space 模板每次有效保存递增版本。
- `CollaborationRun` 保存 `templateId`、版本号和完整 `templateSnapshot`，不依赖模板后续状态。
- 启动事务把快照展开为 Role Binding、Run Task、Task Todo 和 Dependency 运行记录。
- Artifact、Attempt、Review 和 Event 使用独立记录，便于事务、索引、审计和并发控制。

MVP 数据对象固定为 `CollaborationTemplate`、`CollaborationRun`、`CollaborationRoleBinding`、`CollaborationRunTask`、`CollaborationTaskTodo`、`CollaborationTaskDependency`、`CollaborationTaskAttempt`、`CollaborationTaskArtifact`、`CollaborationReview` 和 `CollaborationRunEvent`。状态字段必须使用共享枚举/Schema，不能在客户端和服务端分别维护自由字符串。Run draft 具有递增 `version` 用于乐观更新；Task/Todo/Attempt/Artifact/Review 具有 generation 关联；冗余的 runId/taskId/attemptId 必须由复合外键保证属于同一层级，不能只依赖服务代码约定。

数据库还必须使用 CHECK/唯一约束固定关键不变量：系统模板当且仅当 `scopeKey='system' AND spaceId IS NULL`，Space 模板当且仅当 `scopeKey=spaceId AND spaceId IS NOT NULL`；租约到期时间不晚于最大执行截止；Event 至多一个人类或 Agent actor；同一运行、actor、operation、幂等键唯一。Prisma 不能表达的部分索引或 CHECK 用显式 SQL migration，并以窄 allowlist 的 drift 测试保护，不能扩大现有 pgvector 例外。

## MCP 执行协议

### 加入指令

启动成功后，UI 为每个参与 Agent 生成一段可复制指令，包含运行标识、Agent 在本运行中的 Role Slots 和行为说明，不包含新的长期密钥。Agent 使用现有统一 MCP 连接和当前 AgentCredential 调用 `collaboration_join_run`；服务端以认证 Agent 身份验证不可变 Role Binding 或当前非终态任务负责人资格，不能仅凭 runId 加入。

### MCP 工具

- `collaboration_join_run`：验证 Agent active、Credential 身份/生命周期、Credential 绑定的当前 Space Grant、由 Grant 角色实时派生的 scopes、Role Binding 或当前任务负责人资格及运行状态，返回参与摘要与循环协议；不得从 Credential 读取或持久化独立权限 scopes。
- `collaboration_next_action`：使用 runId、幂等键和有上限的可选长轮询；事务性创建 Task Attempt、签发一个任务租约，或返回 `waiting_dependency | waiting_human | paused | completed`。
- `collaboration_heartbeat`：只有当前 Agent、当前尝试和未过期租约可续租，且不能超过任务最大执行时限；服务端只存租约令牌 hash。
- `collaboration_update_todo`：按序、幂等更新一个 Todo 的 `doing | done | failed`、简短结果和证据。
- `collaboration_submit_result`：校验权限、租约、Todo、大小、Schema、路径、证据和状态后，原子创建产物版本并推进任务。
- `collaboration_get_run`：Agent 只获得运行摘要、自己的 Role Slots/任务和显式可读产物；人类按 Space 权限获得完整看板数据。

所有写 MCP 工具必须使用幂等键。幂等作用域为 `(runId, actorKind, actorId, operation, idempotencyKey)`，并保存规范化请求的 `requestHash`；同作用域同 hash 返回原安全响应，不同 operation、target 或 hash 返回 `COLLABORATION_IDEMPOTENCY_MISMATCH`，不能重复创建 Todo 完成记录、产物、审核或依赖推进。租约明文永不持久化或写日志；只有对已授权的完全相同 claim 重放，才按域隔离 HMAC 确定性重建。

### 循环与人工审核暂停

```text
join_run
  → next_action
  → claim task
  → update todo + heartbeat
  → submit_result
  → next_action
```

Agent 可在 `waiting_dependency` 下按建议间隔短轮询，但不能占用任务租约。`waiting_human` 必须返回 `resumeRequired: true` 和可读原因，不返回暗示继续轮询的 `retryAfterSeconds`。遇到 `waiting_human`、`paused` 或终态时必须报告并安全退出。人工审核通过或人工处理完成后，UI 为受影响 Agent 生成“恢复本次协作”的指令；MVP 不承诺在审核等待数小时后远程自动唤醒已经退出的本地 Agent。

### 人类 REST API 边界

- 模板：list、create、copy、get、validate（非写入）、update（带 expectedVersion）、archive；系统模板只有 list/get/copy。
- 运行向导持久化 draft：create draft、update inputs/bindings（带 expectedVersion）、validate draft（`draft → ready`）、start（`ready → running`）；start 仍在事务中重新预检并保持幂等。
- 运行：list/get，以及 pause、resume、retry、reassign、skip、fail、cancel、review decision。所有写操作都使用人类 actor 作用域的幂等键和 request hash。
- API Controller、前端 client 和实施测试必须使用同一组确切路由；不能让设计声称支持 create/archive/draft，而实现计划只列 list/copy/start。

## 人类权限

### 模板权限

- Space Owner/Admin：复制、创建、编辑、归档和验证 Space 模板。
- 其他成员：可查看模板；MVP 不允许 Editor 修改模板。
- 系统模板：所有可访问用户可查看，任何用户都不能直接修改。

### 运行权限

- Space Owner/Admin/Editor：填写输入、映射 Agent 并启动运行。
- 发起人或 Owner/Admin：暂停、恢复、重试失败任务和改派负责人。
- Owner/Admin：带理由跳过任务、结束为失败或终止运行。
- 审核人：同时满足模板指定用户/Space 人类角色和当前 Space 访问权限。
- Agent：不能修改模板、映射角色、改派、跳过、暂停、终止或执行人工审核。

启动事务必须重新校验模板、当前调用者、每个 Agent、每个 Role Binding 和所有依赖，不能依赖编辑页面加载时的旧数据。

## 前端体验

### 信息架构

Space 导航新增 `Collaboration / 协作`，位于现有 `Runs` 与 `Members` 之间。现有 `Runs` 继续只表示 Source/Ingest Run，避免与 Collaboration Run 混用。协作工作区包含模板库、活跃运行和历史运行。

### 模板配置页

采用表单式目录，不做自由画布：概览、输入变量、角色槽位、流程步骤、输出与发布。流程步骤以有序列表展示，点击后配置；依赖通过选择器设置；页面持续显示缺失角色、依赖环、无入口、无终点、无返回任务和输出契约错误。

### 三步启动向导

1. 工作输入：运行名称和模板变量；
2. 映射 Agent：Role Slot → 当前 Space active Agent；
3. 检查并启动：权限、输入、依赖、利益冲突和输出预检。

启动后展示每个 Agent 的一次加入指令。一个 Agent 兼任多个 Role Slot 时只生成一条合并指令，并提示自审利益冲突。

### 运行看板

桌面端左侧为阶段与依赖进度，中间为当前任务、Todo、等待审核和已接受产物，右侧为参与 Agent 与活动时间线。移动端按“摘要 → 当前任务 → 审核 → 产物 → 活动”单列排列。所有状态同时使用文字和图标，不只依赖颜色。所有用户可见界面和错误必须支持简体中文与英文。Socket.io 事件只触发增量刷新；页面首次进入、恢复焦点和断线重连都以 REST 获取的 PostgreSQL 状态为准。

当前项目已有自建 React/Tailwind 组件，不应为了本功能混入第二套组件库。实现复用 `Layout`、`SpaceNav`、`ModalDialog`、`IconButton`、Toast 和现有表单/卡片视觉语言；只有形成统一迁移计划后才能引入新的组件体系。

## 失败与恢复

### 自动处理

- 领取竞争：数据库事务与条件更新保证只有一个有效 Task Attempt。
- 重复请求：幂等键返回已有结果。
- 临时失败：按模板预算指数退避后重新 ready。`retryBudget` 表示“首次尝试之后允许的重试次数”，因此最大 Attempt 数为 `1 + retryBudget`；Attempt #1 在 budget=1 时进入一次 `retry_wait`，Attempt #2 再失败才耗尽。
- 租约超时：旧尝试失效，任务释放；迟到心跳、Todo 或结果提交被拒绝。
- 输出校验失败：返回结构化问题，在内容修复预算内定向修复，不消耗基础设施重试。
- API/Worker 重启：权威状态在 PostgreSQL，过期租约由恢复扫描处理。每次 claim/heartbeat/Todo/submission 都重新验证当前负责人权限；Worker 处理过期尝试和 due task 时也重新校验当前负责人，发现撤权/降级则以 `agent_authorization_changed` 暂停，绝不自动改派。

### 人工处理

自动重试/修复耗尽、缺少必需输入或上游产物、Agent 撤权/降级、外部引用越界或管理员主动暂停时，运行进入 paused 并显示唯一下一动作。人工可以重试、改派、补充输入、在允许条件下跳过或终止；所有动作记录操作者、理由、前后状态和时间。

### 取消与终止

终止后新任务不再可领取，活跃租约立即失效，迟到提交被拒绝；已有产物、Todo、审核和事件保留。系统不自动删除外部文件、Git 提交或已经发布的 Wiki 页面。

## 安全与隐私

- 所有模板与运行都在 Space 边界内授权；系统模板不包含客户数据。
- Agent 只能读取显式输入和获授权 Task Artifact，不获得整次运行的无边界上下文。
- MCP 不返回其他 Agent 的 Credential、私有 Memory、其他尝试的租约令牌或未声明输入。
- 租约令牌、幂等原材料、连接码、Credential 和本地绝对路径不得进入日志或审计 metadata。
- Markdown/JSON 设定大小和深度上限；外部 URL 只作为引用存储，不由服务端任意抓取。
- 模板变量不能执行脚本、表达式、命令、Webhook 或动态代码。
- Wiki 发布继续走现有 ChangeSet、Space Policy 和人工审核；协作完成只产生 Task Artifact，不等于自动发布。用户或有权限的 Agent 选择发布时，必须通过现有页面提案/ChangeSet 接口，并保留原执行身份。

## 测试与验收

### 共享契约和领域单测

- 五种组件和五个内置模板通过 Zod/Schema；
- 模板版本、快照 hash 和内置 seed 稳定；
- 依赖环、不可达节点、缺失入口/终点和非法返回任务被拒绝；
- Todo 顺序、任务/运行状态机和 Artifact 版本准确；
- `reader < editor = publisher` 的协作执行能力准确，任何角色都没有人工审核能力。

### 服务端 PostgreSQL 集成

- 并发领取同一任务只有一个成功尝试；
- 心跳、租约过期、最大执行时限和恢复扫描；
- Todo、提交、审核、暂停和终止请求幂等；
- Attempt、Artifact、Review、依赖释放和 Event 在事务中一致；
- Agent 撤权、角色降级、Space 删除和运行中重新授权；
- 驳回生成新修订且旧产物不被覆盖；
- 驳回使返回任务到审核下游的旧代 Todo/Attempt/Artifact/Review 全部失效，旧 accepted Artifact 不能继续释放依赖或完成运行；
- 合法改派的新 Agent 能加入并执行，旧租约立即失效；
- pending Review 与另一可执行分支并存时运行保持 running，仅剩人工动作时才 waiting_review；
- `any` 只提前释放下游，其余上游仍参与完成判定，缺失的可选产物不被伪造；
- 终止后旧租约和迟到结果不能复活运行。

### MCP 契约

- Agent 只能加入绑定给自己的运行，领取自己的 ready 任务，读取显式输入；
- 过期或错误租约不能更新 Todo 或提交结果；
- `reader` 只能读，`editor/publisher` 可执行，任何 Agent 都不能审核、改派或终止；
- join/next_action/waiting_human/恢复/终态协议在 Codex、Claude Code 和 OpenCode 的统一 gateway 中一致。

### 前端

- Space 协作导航、模板库、配置目录、三步启动和运行看板；
- Owner/Admin/Editor/Viewer 与审核人权限矩阵；
- 加载、空、错、冲突、撤权、暂停、审核和终态；
- 中英文、键盘焦点、对话框焦点锁、状态非颜色依赖；
- 桌面与 390px 移动视口无横向溢出。

### 真实端到端

至少使用两种真实已连接 Agent 客户端完成：

1. 启动编码模板，把规划、两个并行实现和测试映射到至少两个 Agent；
2. 验证并发领取互不重复、Todo 顺序、心跳和 commit/测试证据引用；
3. 到达人工审核点后 Agent 安全退出，人类驳回一次并恢复指定 Agent；
4. 再次提交并由人类通过，汇总任务形成最终产物；
5. 制造一次租约超时或撤权，验证自动释放、暂停和人工改派；
6. 完成一个标书模板端到端运行，验证三个真实人工门和机器门不混用；
7. 按清单清理临时资源，且不影响非测试资源。

### 发布门槛

实现完成后运行 server、client、sync-protocol、local-sync、MCP、类型检查、lint、build 和 Prisma 迁移门禁。数据库集成测试必须使用专用测试连接，在随机且带固定测试前缀的 PostgreSQL schema 中执行 migration；finally 只删除精确生成的 schema，禁止对未验证的 `DATABASE_URL` 直接迁移或清理。部署生产需另行授权，并执行只读预检、PostgreSQL/应用回滚备份、迁移检查、服务观察、公网健康和业务 smoke。开发测试通过不自动触发 push、npm 发布或生产部署。

## MVP 不做

- AgentWiki 服务端托管模型或 Agent runtime；
- 远程自动唤醒 Codex、Claude Code 或 OpenCode；
- 从空白拖拽任意连线；
- 条件表达式、循环、定时器、Webhook、子流程和任意脚本；
- 动态能力竞领、自动候选排序或自动改派；
- 通用文件上传、在线 Office 预览或代码仓库托管；
- 把 Collaboration Template 与本地知识 Recipe 合并；
- Agent 人工审批、成员管理或 `review:decide`；
- 协作完成后绕过 ChangeSet/Space Policy 自动发布 Wiki。

## 实施顺序

1. 以已发布并通过生产验证的统一访问角色 `0.5.1` 为基线。
2. 在共享协议中扩展协作 scopes、模板 Schema、状态枚举和 MCP DTO。
3. 实现服务端模板、运行、任务、租约、产物、审核和事件核心。
4. 实现 Agent MCP 执行循环和授权边界。
5. 实现 Space 协作入口、模板配置、启动向导和运行看板。
6. 加入五个内置模板并完成自动化、真实多 Agent 和发布前验证，把统一发布版本提升到 0.6.0。

## 完成标准

- 五个内置模板和五类组件均可在 Space 中复制、配置、验证和启动；
- 模板编辑不改变已有运行，系统模板更新不改变用户副本；
- 外部 Agent 可通过统一 MCP 安全、幂等地循环执行自己的任务；
- 依赖、并行、Todo、产物、人工审核、租约、重试、改派和终态符合本设计；
- 访问角色、Space Grant、Credential、Agent 状态和人工审核边界没有绕过；
- 运行看板在中英文、桌面和移动端可用；
- 自动化与真实多 Agent E2E 提供新鲜证据；
- 未经单独授权不 push、不发布 npm、不部署生产。
