# AgentWiki 组合式页面组模板与 Agent 协作设计

**日期：** 2026-09-05

**状态：** 各设计章节已确认，待正式文档总体验收

**选定方案：** A+——统一组合模板事实源，复用页面树、协作运行和 ChangeSet 审核三个既有运行时

## 1. 结论

AgentWiki 的“新建页面”升级为统一模板入口，同时支持：

1. 单页面模板；
2. 可包含多层真实 Folder 与 Page 的多页面模板；
3. 创建时可选的 Agent 协作设置；
4. 历史页面或普通页面后续绑定 Agent、批量配置并启动协作；
5. 把现有目录裁剪、抽象并保存为 Space 多页面模板。

模板定义采用一个不可变、版本化的组合 `TemplateVersion` 作为页面结构与协作蓝图的唯一事实源。实例化后仍由既有内容树、协作控制面和页面 ChangeSet 审核分别持有自己的运行时状态，不把三套状态机揉成一个新的巨型状态机。

本方案不修改 Folder 的同步语义，不调整附件、Markdown 图片引用或 Sync v3 协议。任何后续实现如果需要触及这些边界，必须停止并作为独立范围重新评估。

## 2. 背景与现状判断

### 2.1 现有设计不是实现缺陷

2026-08-25 的页面模板设计明确把范围限制为单页模板，并明确排除“一次创建多个页面”和 Agent 页面提案流程。因此，当前“项目管理”模板只生成一个页面，是旧范围的预期结果，不是页面树创建失败。

现有设计的优点是：

- 创建事务短、失败面小；
- 页面模板和协作模板职责独立；
- 模板版本与已创建页面之间没有实时耦合；
- 权限和兼容性边界清楚。

但产品需求已经发生变化，旧设计现在暴露出以下不足：

- 项目管理等工作场景被压缩成一个过长页面，无法形成可导航的工作区；
- 页面模板和协作模板存在两套入口、两套选择心智；
- 协作任务产物与 Wiki 页面之间缺少显式目标关系；
- 页面没有长期主责 Agent，重复运行需要重复映射；
- 现有目录结构不能直接沉淀为可复用的多页面协作模板。

### 2.2 本次演进原则

- 统一模板事实，不统一运行时状态机。
- 创建页面结构与启动协作是一次用户流程中的两个阶段，不是不可拆分的行为。
- Agent 绑定是页面的长期默认责任关系，不是权限授予，也不是每次运行的自动参与名单。
- 协作参与者由本次启用任务决定。
- 页面内容的 Agent 结果必须通过既有 ChangeSet 审核发布，不直接覆盖 Page。
- 迁移只做增量兼容，不重写历史运行或强制回填历史页面。

## 3. 目标与不做

### 3.1 目标

- 新建入口按“单页面 / 多页面”清晰分类，并同时展示系统与 Space 模板。
- 项目管理模板一次性创建常用目录、页面和可选协作定义。
- 五类既有系统协作模板都有对应的多页面组合模板。
- 多页面模板支持多个子文件夹，实例化为真实 Folder 与 Page。
- 创建时可关闭协作，只生成正常可编辑的页面组。
- 创建时开启协作后，先完成角色到 Agent 的映射，再原子创建页面组、绑定和运行。
- 任意历史页面可在以后建立、变更或解除主责 Agent 绑定。
- 一个现有目录可保存为 Space 多页面模板，但不携带具体 Agent、授权和运行历史。
- 页面目标任务提交后形成 Artifact 与 ChangeSet，并通过一次人工审核完成协作接受和页面发布。
- 旧模板、旧运行、旧页面继续可用，支持灰度和安全回滚。

### 3.2 本期不做

- 不自动远程唤醒 Codex、Claude Code、OpenCode 或其他外部 Agent。
- 不为 Folder 绑定 Agent；只有 Page 可以绑定 Agent 或成为任务目标。
- 不因绑定关系创建或提升 `AgentGrant`。
- 不让 Agent 完成人工审核。
- 不把模板系统扩展成通用可视化工作流编排器。
- 不复制附件，不重写 Markdown 图片引用，不修改 Sync v3 manifest 或协议。
- 不自动推断 Space 自定义旧协作模板应具有的页面结构。
- 不重写旧 CollaborationRun 的模板快照。
- 不在本期支持同一 Page 上多个并行写入任务；需要多 Agent 时使用上游研究任务加一个显式合并任务。

## 4. 核心术语与不变量

### 4.1 Template 与 TemplateVersion

产品和服务层统一使用 `Template / TemplateVersion`。为降低迁移风险，首个实现阶段允许数据库继续使用现有 `PageTemplate / PageTemplateVersion` 表名。

每个新版本由两部分组成：

```text
TemplateVersion
├── pageDefinition
│   ├── kind: single_page | page_group
│   └── nodes: FolderNode | PageNode
└── collaborationDefinition?   # 可选
    ├── inputs
    ├── roleSlots
    ├── tasks / todos / dependencies / reviews
    └── taskNodeId -> pageNodeId
```

核心不变量：

- `single_page` 恰好包含一个 PageNode，不能包含 FolderNode。
- `page_group` 恰好包含一个根 FolderNode，并包含受限深度和数量的后代。
- 每个节点有版本内稳定且唯一的 `nodeId`、`parentNodeId` 和 `order`。
- FolderNode 只表达层级、名称和顺序，不能持有 Agent 或任务。
- PageNode 保存本地化标题、Markdown 快照和可选的 `roleSlotKey`。
- 页面目标任务必须显式保存 `taskNodeId -> pageNodeId`，不得根据文件名或目录位置推断。
- 一个 PageNode 在同一工作流中最多有一个直接写入任务；多 Agent 结果由显式合并任务收敛。
- 系统模板同时保存 `zh-CN` 与 `en`；Space 模板保存来源语言并按既有规则回退。
- 模板版本不可变；实例化和运行均记录精确版本。

### 4.2 TemplateInstantiation

一次模板实例化的审计根，记录：

- Space、模板和版本；
- 创建人；
- 目标父 Folder；
- 请求幂等键及请求哈希；
- 创建时内容树版本；
- 可选的 CollaborationRun；
- 创建结果状态和时间。

`TemplateInstantiationNode` 显式保存：

```text
templateNodeId -> actualFolderId | actualPageId
```

映射保存在独立领域表，不向 Folder 或 Sync v3 manifest 写入模板专用字段。

### 4.3 PageAgentBinding

`PageAgentBinding` 表示一个 Page 当前的长期主责 Agent：

```text
pageId
spaceId
agentId
roleSlotKey?
assignedByUserId
updatedAt
```

每个页面最多有一个当前主责 Agent。建立、更换和解除操作进入独立审计事件；不通过修改历史行伪造历史。

绑定不变量：

- 未绑定是正常状态，历史页面不强制回填。
- 绑定不创建、不升级、不恢复 AgentGrant。
- 只能选择当前 Space 中 active 且具有所需协作权限的 Agent。绑定时可以保存尚未在线的长期负责人，但必须显示准备状态；启动 Run 时仍需通过既有 Agent 准备和连接预检。
- 页面主责变化只影响未来运行；活动 Run 使用启动时冻结的负责人。
- 解除绑定不删除历史运行、任务、产物或审核。

### 4.4 本次运行的参与 Agent

绑定关系不等于本次协作成员。参与者集合按以下公式确定：

```text
本次启用的任务
  -> 每个任务启动时冻结的负责人
  -> 按 Agent 去重
  -> 生成每个 Agent 一份合并启动指令
```

- 页面不在本次范围内，其 Agent 不参与。
- 页面在范围内但没有启用任务，其 Agent 不参与。
- 同一 Agent 负责多个任务，只加入一次并收到一份合并指令。
- 启用任务缺少有效负责人时，启动预检失败并要求补充映射。
- 单页面“启动协作”会创建当前页面的单页任务，因此默认纳入当前绑定 Agent。

## 5. 系统模板目录

### 5.1 单页面模板

继续保留适合独立文档的模板，例如：

- 空白页面；
- 任务清单；
- 日报；
- 周报；
- 会议纪要；
- 决策记录；
- 复盘总结。

所有单页面模板都可在创建后绑定 Agent。创建时开启协作时，默认生成一个目标为该页面、需要人工审核的轻量任务。

### 5.2 多页面模板

首批系统多页面模板至少包括：

| 模板 | 代表性结构 | 协作角色 |
|---|---|---|
| 项目管理工作区 | 项目概况；计划/里程碑、任务清单；治理/风险与阻塞、决策记录；进展/进展记录、项目复盘 | 项目负责人、执行负责人、风险审查 |
| 编码协作 | 需求、技术设计、任务拆解、实现记录、测试、代码评审、发布记录 | 规划、实现、测试、审查 |
| 标书撰写 | 招标资料、评分矩阵、章节稿、合规检查、审核、交付 | 统筹、商务、技术、审校 |
| 论文撰写 | 研究问题、文献、方法、数据、章节稿、审校、投稿 | 研究、分析、写作、审校 |
| 视频脚本 | 创意、受众、资料、分镜、脚本、审校、发布 | 策划、研究、编剧、审校 |
| 小说撰写 | 世界观、人物、情节、章节、连续性检查、修订 | 主创、设定、写作、审校 |

目录和页面正文的精确内容作为系统 seed 的独立实现资产维护，并遵守版本不可变规则。

旧系统“项目管理”单页版本继续保留历史读取和页面来源引用，但从新建目录隐藏；新的“项目管理工作区”成为用户可见入口，避免两个同名模板并存。

## 6. 用户流程

### 6.1 从模板创建

统一新建入口采用三步流程：

1. **选择模板**：支持全部、单页面、多页面、Space 模板筛选；卡片展示页数、目录数、角色数和是否支持协作。
2. **预览结构**：编辑根名称，预览真实 Folder/Page 树和页面角色槽；“启用 Agent 协作”默认关闭。
3. **协作设置**：仅在开启协作时出现；把角色槽映射到当前 Space Agent，显示权限和连接状态，预览任务范围及实际参与者。

关闭协作时，提交按钮为“创建页面”或“创建页面组”。开启协作时，提交按钮为“创建并启动协作”。

创建成功后：

- 单页进入新页面；
- 页面组进入根目录概览或首个介绍页；
- 已启动协作时同时展示 Run 入口和按 Agent 合并后的可复制启动指令。

### 6.2 历史页面后绑定

所有 Page 的标题区或更多菜单提供“绑定 Agent / 协作设置”：

- 只建立长期绑定；
- 建立绑定并立即启动一次单页协作；
- 更换主责 Agent；
- 解除绑定；
- 使用当前绑定 Agent 启动新的协作。

Folder 菜单提供批量“协作设置”，作用范围可为当前页、所选页面或整个子树。批量操作只为 Page 创建或更新绑定，不给 Folder 绑定 Agent。

### 6.3 保存现有目录为 Space 模板

Owner/Admin 从 Folder 菜单选择“保存为 Space 模板”：

1. 选择一个根 Folder；
2. 服务端递归读取同一 Space 的真实子树；
3. 用户预览并排除临时 Folder/Page；
4. 页面当前具体 Agent 被抽象为可编辑 Role Slot；
5. 用户选择只保存结构，或同时保存协作流程；
6. 页面目标任务显式映射到保留的 PageNode；
7. 服务端从已保存页面读取权威 Markdown，创建不可变模板版本。

协作流程来源只能是以下三类之一，不能从运行历史中猜测：

- 当前目录原本由组合模板创建：复制其来源 TemplateVersion 的协作定义，再应用用户本次裁剪；
- 用户选择一个现有协作模板：复用其定义并通过表格显式映射任务到所选 PageNode；
- 用户选择“生成简单页面协作”：为每个已分配 Role Slot 的页面生成一个相互独立、强制人工审核的页面任务，用户再使用既有结构化编辑器调整依赖和审核。

如果用户选择“只保存结构”，模板不包含 Role Slot、任务或 Review；页面原有绑定也不会进入模板。

不会保存 Agent ID、AgentGrant、Credential、密钥、运行状态、Artifact、Review 或事件时间线。使用模板时重新映射当前 Space Agent。

首期只保存 Markdown 和 Folder/Page 结构。检测到所选页面存在附件关系时，保存前明确提示附件不会复制；用户可以返回排除页面或继续保存文本模板。不得为此修改附件或 Sync v3 模型。

## 7. 权限与安全

### 7.1 人类权限

| 操作 | 权限规则 |
|---|---|
| 查看模板目录 | 沿用 Space 读取权限 |
| 从模板创建 Page/Folder | 当前 Space 的内容树写入权限 |
| 启动协作 | 内容写入权限与既有 collaboration run 创建权限的交集 |
| 建立或批量修改 PageAgentBinding | 内容管理权限；服务端重新验证目标页面和 Agent 均属于当前 Space |
| 保存或升级 Space 模板 | Owner/Admin |
| 人工审核页面结果 | 既有服务端 `Review.canDecide` 权威判断 |

### 7.2 Agent 权限

- 角色槽只表达模板职责，不能替代 `AgentGrant.role`。
- 绑定和启动时都实时检查 Agent 状态、Space Grant、Credential 和派生 collaboration scope。
- `reader` 不能被映射为执行任务负责人。
- `editor` 和 `publisher` 都可执行协作；publisher 不因此获得人工审核权。
- Agent 被撤权、停用或断开时，活动运行按既有撤权规则暂停或改派，不静默降级。
- 本期不开放 Agent 通过模板接口创建页面组；保留当前人类控制的模板创建边界。

## 8. 实例化事务

统一写接口：

```text
POST /spaces/:spaceId/templates/:templateId/instantiate
```

请求至少包含：

```text
templateVersion
targetParentFolderId?
variables
collaborationEnabled
roleBindings?
enabledTaskNodeIds?
expectedTreeRevision
idempotencyKey
```

### 8.1 预览

预览接口只做读取与确定性展开，返回：

- 解析变量后的 Folder/Page 树；
- 目录深度、节点数和 Markdown 总量；
- Role Slot、页面目标任务和依赖；
- 当前建议 Agent 映射及权限状态；
- 实际将参与的 Agent 集合；
- 附件不复制等警告；
- 当前内容树 revision。

预览不是授权凭证。提交时必须完整重验。

### 8.2 提交预检

提交事务开始前和锁定后必须验证：

- 用户和 Space 有效；
- 模板未归档且请求版本存在；
- 节点 schema、父子关系、深度、数量和内容大小均在上限内；
- 目标父 Folder 仍存在且属于当前 Space；
- `expectedTreeRevision` 未过期；
- 所有必需角色已映射；
- Agent active 并具有足够角色；若开启协作，所有实际参与 Agent 还必须通过既有连接与准备状态预检；
- Human Review 只有合法人类审核人；
- 任务与 PageNode 映射完整且没有多写者；
- 幂等键未被不同请求体使用。

模板限制采用服务端常量并在实现计划中固化；建议初始上限为深度 8、总节点 100、Page 50、Markdown 总量 5 MiB，压测后只能通过显式版本化配置调整。

### 8.3 串行化事务顺序

一个 serializable 事务完成：

1. 锁定当前 Space 的内容树写入路径并复核 tree revision；
2. 按父节点优先顺序创建 Folder；
3. 创建 Page 与初始版本；
4. 只推进一次内容树 revision；
5. 创建 TemplateInstantiation 与节点映射；
6. 若请求提交了角色映射，为对应页面创建 PageAgentBinding 和审计事件；关闭协作且没有映射时不创建绑定；
7. 若开启协作，创建 CollaborationRun、冻结模板快照和 Role Binding；
8. 展开 Run Task、Todo、Dependency、Review，并把 `targetPageId` 写入页面任务；
9. 保存幂等请求哈希和结果。

任一步失败，Folder、Page、Binding、Run 和内容树 revision 全部回滚。不能留下半棵目录树或“页面已创建、协作没创建”的模糊成功。

数据库提交后再触发搜索索引、知识图谱、Socket 通知等外围动作。外围失败进入可重试队列，不把已经提交的权威创建结果报告为失败。

### 8.4 幂等与重试

- 同一 Space、用户和 `idempotencyKey` 唯一。
- 请求体规范化后保存哈希。
- 相同键、相同哈希返回原结果。
- 相同键、不同哈希返回确定性冲突。
- 序列化冲突按有限次数退避重试；超过预算返回可重试错误，不切换到非事务创建。

## 9. 页面目标任务与统一审核

### 9.1 启动快照

每个页面目标 RunTask 保存：

```text
targetPageId
basePageVersion
baseContentHash
assigneeAgentId
templateTaskNodeId
```

绑定变化不修改这些字段。

### 9.2 Agent 提交

页面目标任务提交时，在同一权威操作中创建：

1. CollaborationArtifact；
2. 以当前任务基线为来源的 Page ChangeSet；
3. Artifact、RunTask、Page 和 ChangeSet 的显式关联；
4. 强制 Human Review。

即使负责人是 publisher，也不能在该路径自动发布。非页面目标的研究、检查或外部引用任务可以继续只产生 Artifact，并沿用既有协作审核规则。

### 9.3 一次审核完成两层决定

界面只展示一个协作审核动作。审核事务原子完成：

- 决定 CollaborationReview；
- 接受或拒绝 Artifact；
- 审批或拒绝 ChangeSet；
- 通过时创建 PageVersion 并发布；
- 推进或回退 RunTask 与 CollaborationRun；
- 写入统一审计事件。

不能要求用户先批准协作 Artifact、再到另一个入口批准同一份页面 ChangeSet。

### 9.4 页面版本冲突

如果 Page 已不再等于任务启动时的 `basePageVersion/baseContentHash`：

- 禁止批准和覆盖；
- Run 进入明确的页面版本冲突暂停状态；
- 用户可以让 Agent 基于最新页面重新生成；
- 或由人类手动合并后选择“采用当前页面”。

“采用当前页面”会把旧 ChangeSet 标记为 superseded，记录当前 PageVersion 为本任务被接受的结果引用，再推进运行；它不是对过期补丁的隐式批准。

## 10. 接口边界

建议接口分组：

```text
GET    /spaces/:spaceId/templates
GET    /spaces/:spaceId/templates/:templateId
POST   /spaces/:spaceId/templates/:templateId/preview
POST   /spaces/:spaceId/templates/:templateId/instantiate

POST   /spaces/:spaceId/templates/from-folder/preview
POST   /spaces/:spaceId/templates/from-folder
POST   /spaces/:spaceId/collaboration-templates/:legacyId/upgrade/preview
POST   /spaces/:spaceId/collaboration-templates/:legacyId/upgrade

GET    /spaces/:spaceId/pages/:pageId/agent-binding
PUT    /spaces/:spaceId/pages/:pageId/agent-binding
DELETE /spaces/:spaceId/pages/:pageId/agent-binding
POST   /spaces/:spaceId/folders/:folderId/agent-bindings/preview
POST   /spaces/:spaceId/folders/:folderId/agent-bindings

POST   /spaces/:spaceId/pages/:pageId/collaboration-runs
```

旧 `/page-templates` 和 `/collaboration/templates` 接口在过渡期通过兼容服务继续读取旧数据。新客户端只通过统一 catalog 读取新建入口。

## 11. 数据模型增量

### 11.1 复用与扩展

- 复用 `PageTemplate` 的 scope、元数据、归档和 currentVersion 语义。
- 扩展 `PageTemplateVersion`，增加严格校验的组合 definition、definition schema 版本和内容 hash；旧 `contentI18n` 保留兼容读取。
- 复用现有 `CollaborationTemplateDefinition` 的输入、Role Slot、Task、Todo、Dependency、Review 契约，并增加页面节点目标映射。
- `CollaborationRun` 增加可空的 `templateInstantiationId` 和组合模板来源版本。
- `CollaborationRunTask` 增加可空的页面目标与基线字段。

### 11.2 新实体

```text
TemplateInstantiation
TemplateInstantiationNode
PageAgentBinding
PageAgentBindingEvent
CollaborationArtifactChangeSetLink  # 或等价的受约束外键组合
```

数据库约束必须保证：

- 一个实例化中的 templateNodeId 唯一；
- 映射行只能指向 Folder 或 Page 之一，且类型匹配；
- 每个 Page 只有一个当前绑定；
- 绑定的 Page、Agent、Run、模板均属于同一 Space；
- 页面目标任务的 ChangeSet 关联唯一且不可跨 Page；
- 幂等键作用域和请求哈希不可冲突。

## 12. 兼容迁移

### 12.1 旧 PageTemplate

- 现有版本可自动包装成 `single_page`、单 PageNode 的组合定义。
- 原 `contentI18n` 和来源字段继续可读，避免破坏旧页面来源审计。
- 除旧“项目管理”外，当前适合单页的系统模板继续出现在单页面分类。
- 旧“项目管理”退出新建目录但不物理删除；新建目录显示新的“项目管理工作区”。

### 12.2 旧 CollaborationTemplate

- 历史模板、快照和运行不改写。
- 旧入口在过渡期继续启动旧模板。
- 五个系统协作模板由 seed 发布对应的组合多页面版本。
- 旧系统 CollaborationTemplate 转为兼容只读，不再承接新写入。

Space 自定义协作模板不能自动推断页面树：

- 在模板管理中显示为“待升级的协作流程”；
- Owner/Admin 选择已有 Folder 或新建页面树；
- 显式把旧任务映射到 PageNode；
- 校验通过后创建新的组合 TemplateVersion；
- 原模板仍可用于旧入口和历史运行。

## 13. UI、可访问性与错误处理

- 复用现有 ModalDialog、Tailwind 组件、焦点陷阱和 SpaceNav，不引入第二套 UI 系统。
- 所有新文案提供简体中文和英文。
- 卡片选中、Agent 状态、错误和冲突不能只靠颜色表达。
- 桌面端可并排显示模板、树和协作摘要；390px 移动端按步骤单列。
- 创建中禁用重复提交，但保留安全取消和失败后的输入。
- 权限不足的 Agent 在选择器中禁用，并给出前往既有授权流程的明确入口。
- 模板版本过期、树版本冲突、Agent 撤权、重名、越界、附件警告和页面版本冲突分别使用稳定错误码，不能统一显示为“创建失败”。
- 失败后保留用户的变量、树裁剪、角色映射和任务选择；用户修复后可以重试同一个幂等请求。

## 14. 灰度、回滚与可观测性

### 14.1 发布顺序

1. 上线增量 schema 与双读兼容，不开放新 UI。
2. 自动包装旧单页版本并 seed 新系统组合模板。
3. 上线统一 catalog、预览和实例化 API。
4. 按内部 Space 开启新建入口。
5. 验证后逐步扩大 Space 范围。
6. 过渡期结束后停止旧模板新写入，但保留历史读取。

### 14.2 回滚

- 功能开关关闭后恢复旧新建页和旧协作入口。
- 已创建 Folder/Page 是正常内容，不删除、不回滚用户数据。
- 已创建 Run 按既有协作控制面继续运行。
- 新增数据表和字段保留，不能用破坏性 down migration 回滚生产数据。

### 14.3 观测指标

- catalog/preview/instantiate 成功率和延迟；
- 创建节点数、事务冲突和重试次数；
- 创建后外围任务失败与重试；
- 开启协作比例、映射预检失败原因；
- 后绑定、批量绑定、更换和解除次数；
- 页面任务审核通过、驳回和版本冲突率；
- 旧协作模板升级完成率。

日志和事件只记录 ID、稳定错误码和计数，不记录 Credential、密钥或完整敏感正文。

## 15. 测试与验收

### 15.1 单元与契约

- 组合 definition 严格 schema、未知字段拒绝和稳定 hash；
- Page/Folder 树唯一根、无环、父节点存在、顺序稳定和上限；
- Role Slot、任务、目标 PageNode、依赖和 Review 全引用完整；
- 禁止一个 PageNode 多个直接写者；
- 参与 Agent 按启用任务计算、去重且不受范围外绑定影响；
- 旧 PageTemplate 自动包装与旧 CollaborationTemplate 双读。

### 15.2 服务与数据库集成

- 单页、多页、嵌套 Folder 实例化；
- 协作关闭时不创建 Run/Binding；
- 协作开启时页面、绑定、Run 和任务同时成功；
- 任一步故障时完整回滚且 tree revision 不前进；
- 相同幂等请求返回同一结果，不同请求哈希冲突；
- Agent 撤权、停用、跨 Space 和 reader 映射被拒绝；
- 后绑定、更换、解除和批量绑定审计正确；
- 活动 Run 的冻结负责人不随长期绑定变化；
- Artifact + ChangeSet + 单次审核原子推进；
- 页面并发修改产生冲突且绝不覆盖；
- “采用当前页面”保留审计并废止过期 ChangeSet。

数据库测试只能使用专用隔离数据库和随机 schema，不得迁移或清理 shared `public`。

### 15.3 前端与真实 UI

- 桌面与 390px 移动端三步创建流程；
- 单页面 / 多页面 / Space 分类和空目录容错；
- 页面树预览、裁剪、角色映射、权限禁用和错误恢复；
- 历史页面后绑定与 Folder 批量入口；
- 按任务计算参与者和合并指令；
- 页面版本冲突的重新生成与采用当前页面流程；
- 中文和英文；键盘、焦点恢复、Escape 和可读状态文本。

最终验收必须通过真实浏览器完成完整业务流，而不是只验证组件截图或 API 健康端点。

### 15.4 代表性端到端

至少验证：

1. 项目管理工作区关闭协作：一次创建完整多层目录，所有页面正常编辑。
2. 项目管理工作区开启协作：完成 Agent 映射、创建 Run、复制合并指令、Agent 提交、人工审核并发布页面。
3. 历史页面后绑定：绑定后启动单页协作，更换绑定不改变活动 Run。
4. 现有目录保存模板：裁剪页面、抽象角色、在另一个目标位置实例化一致结构。
5. 页面并发编辑：审核进入冲突，不覆盖新版本。
6. 旧单页模板、旧协作模板和历史 Run 仍可使用。

## 16. 实现边界与预期落点

实现应优先复用和扩展：

- `apps/server/src/page-templates/`：统一模板 catalog、版本、预览和 Space 模板管理；
- `apps/server/src/core/page/` 与既有 content-tree revision writer：原子 Folder/Page 创建；
- `apps/server/src/collaboration-workflows/`：Run 快照、任务展开、执行和审核；
- `apps/server/src/review/`：ChangeSet 创建与页面发布；
- `apps/client/src/features/page-templates/`：统一新建与模板管理；
- `apps/client/src/features/collaboration/`：角色映射、运行看板和审核；
- `packages/sync-protocol/` 中既有协作契约：新增组合模板 schema 时保持客户端、服务端和 MCP 单一事实。

不得把模板节点映射写入 Sync v3 Folder/Page manifest，也不得为了模板复制实现附件同步变体。

## 17. 已确认决策摘要

1. 使用统一组合 TemplateVersion，但保留三个独立运行时模块。
2. 创建页面树后可选启动协作；协作开关默认关闭。
3. Page 可以长期绑定一个主责 Agent；Run 启动时冻结负责人。
4. 系统和 Space 都支持多页面模板，并可从现有 Folder 保存。
5. 模板保存 Role Slot，不保存具体 Agent。
6. 任务显式映射 PageNode；Folder 不绑定 Agent。
7. 创建与 Run 展开全有或全无，使用一次内容树 revision。
8. 页面任务通过 Artifact + ChangeSet + 一次人工审核发布。
9. 历史页面随时可后绑定、批量绑定或绑定后立即启动。
10. 本次参与 Agent 由启用任务计算，不把所有历史绑定 Agent 自动纳入。
11. 旧单页自动兼容；系统协作模板发布组合新版；Space 自定义旧流程显式升级。
12. 不修改附件、图片引用和 Sync v3 协议。

## 18. 后续门禁

本文档通过总体验收后，下一步仅编写实施计划。开始编码仍需用户单独明确“继续实施”。

实施必须：

- 从最新 `master` 创建独立 `codex/` 分支和 worktree；
- 先检查是否与 `codex/referenced-image-sync-v3`、`codex/technical-debt-integration` 或其后续分支冲突；
- 若需要修改 Sync v3、附件、Markdown 图片引用或相关迁移，立即停止并请求重新授权范围；
- 使用测试驱动开发，分阶段进行后端、前端、数据库和真实 UI 验证；
- 完成代码审查和修复闭环；
- 未获得独立授权时不 push、不发布 npm、不部署生产。
