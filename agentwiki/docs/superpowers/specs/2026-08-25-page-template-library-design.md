# AgentWiki 页面模板库设计

**日期：** 2026-08-25

**状态：** 已确认，等待实施计划

**范围：** Space 内新建单个页面时使用系统模板或 Space 自定义模板

## 1. 背景与目标

当前 Space 的“新建页面”弹窗只收集标题和父页面，创建后进入空白 Markdown 编辑器。用户每次都需要重新搭建任务清单、项目管理、日报、周报、会议纪要等常用结构，也无法把团队已经稳定使用的页面结构沉淀为 Space 规范。

本功能建立两层模板能力：

1. 七个不可变、双语、版本化的系统模板，提供开箱即用的常见工作结构。
2. Space Owner / Admin 可以把已经保存的 Markdown 页面保存为独立快照模板，供当前 Space 的页面编辑者复用。

成功标准是：用户从点击“新建页面”到进入带初始内容的编辑器，只需完成“选择模板”和“填写页面信息”两个步骤；模板更新、归档或来源页面变化不得反向修改已经创建的页面。

## 2. 范围与不做

### 2.1 本期范围

- 单页模板，不一次创建页面树或项目套装。
- 一个虚拟“空白页面”入口和七个系统模板。
- Space 级自定义模板的创建、元数据编辑、内容更新、归档与恢复。
- 模板内容版本、来源页面和创建页面的来源版本记录。
- 中文、英文、桌面和 390px 移动端界面。
- Markdown 模板；系统和自定义模板都通过服务端权威快照创建页面。

### 2.2 本期不做

- 不支持个人私有模板、跨 Space 模板或平台级自定义模板。
- 不支持一次创建多个页面、数据库看板、任务状态机或新的富文本组件。
- 不支持用户修改系统模板。
- 不支持自定义模板自动翻译。
- 不提供模板内容版本回滚界面；历史版本仅用于不可变来源和后续扩展。
- 不新增模板 MCP 工具，也不改变 Agent 现有页面提案流程。

## 3. 模板目录

新建弹窗展示八个系统入口，其中“空白页面”是虚拟入口，不保存为数据库模板；其余七个是服务端版本化系统模板。

| 分组 | 模板 | 默认标题 | 主要区块 |
|---|---|---|---|
| 基础 | 空白页面 | 空 | 无正文 |
| 计划执行 | 任务清单 | 任务清单 | 工作目标、最高优先级、待办、等待或阻塞、已完成 |
| 计划执行 | 项目管理 | 项目名称 | 项目概况、目标与不做、里程碑、任务、风险、决策、进展记录 |
| 汇报协作 | 日报 | 日报 `{date}` | 今日完成、正在进行、问题与阻塞、明日计划、需要协助 |
| 汇报协作 | 周报 | 周报 `{year}` 年第 `{week}` 周 | 摘要、目标进展、成果、问题与风险、下周计划、需要协调 |
| 汇报协作 | 会议纪要 | 会议纪要 `{date}` | 会议信息、目标、议程、讨论、决定、行动项、待议事项 |
| 知识沉淀 | 决策记录 | 决策：主题 | 状态、背景、备选方案、最终决定、依据、影响、后续动作 |
| 知识沉淀 | 复盘总结 | 复盘：主题 | 目标与结果、做得好的、可改进的、洞察、行动项、检查日期 |

系统模板同时保存 `zh-CN` 和 `en` 的名称、说明、默认标题和 Markdown 正文。`{date}`、`{year}`、`{week}` 只用于系统默认标题，由客户端按浏览器本地日期生成建议标题；周数采用 ISO-8601 week。用户在创建前可以修改。自定义模板的默认标题是普通文本，不支持动态占位符。

系统模板正文只使用 AgentWiki 已支持的 GFM Markdown：标题、列表、任务复选框和表格。正文保持短小，创建后可以直接填写，不放置需要先大段删除的教学说明。

主流团队知识库的常用模板集中在项目计划、周报、会议记录、行动项和决策跟踪，本目录据此覆盖“计划—执行—同步—沉淀”的完整链路：

- <https://www.atlassian.com/en/software/confluence/templates/categories/project-planning>
- <https://www.atlassian.com/software/confluence/templates/weekly-meeting-notes>

## 4. 新建页面交互

### 4.1 第一步：选择模板

现有 `SpaceView` 的创建弹窗拆为独立 `NewPageDialog`，继续复用项目现有 `ModalDialog`、Tailwind 控件和焦点管理，不引入第二套组件库。

第一步包含：

- “全部”“系统模板”“Space 模板”筛选。
- 卡片名称、简短说明、分组和“系统 / Space”标识。
- 默认选中“空白页面”。
- 桌面端两列卡片；390px 移动端单列。
- Owner / Admin 可见“管理 Space 模板”入口。

模板列表请求失败时显示错误和重试，但保留虚拟“空白页面”，确保原有创建能力不被远端模板故障阻塞。

### 4.2 第二步：填写页面信息

第二步包含：

- 根据模板生成但可编辑的页面标题。
- 沿用现有父页面选择。
- 所选模板的名称、说明和版本摘要。
- “返回选择模板”“取消”和“创建”动作。

创建中禁用关闭和重复提交。创建成功后关闭弹窗并进入 `/pages/:id/edit`。失败时保留模板、标题和父页面选择，并在弹窗内显示明确错误。

### 4.3 可访问性与视觉

- 使用 `aria-labelledby`、现有焦点陷阱、Escape 关闭和关闭后焦点恢复。
- 标题输入是第二步的初始焦点。
- 选中卡片必须同时有边框、背景和可读状态文本，不能只依赖颜色。
- 继续使用项目现有产品视觉；不为模板功能引入 shadcn/ui 或其他组件系统。

## 5. Space 模板管理

### 5.1 入口

在 `/spaces/:id/settings` 增加“页面模板”卡片，显示有效自定义模板数量和“管理模板”按钮。按钮进入独立路由：

```text
/spaces/:id/settings/page-templates
```

独立管理页复用 `SpaceNav`，支持搜索、按分组筛选、查看系统模板、管理 Space 模板以及查看已归档 Space 模板。系统模板只读展示。

### 5.2 从页面保存模板

Page Editor 顶部增加“更多”菜单。当前用户是 Space Owner / Admin、页面格式是 `markdown`、页面已经保存且没有未保存修改时，显示“保存为 Space 模板”。

弹窗收集：

- 模板名称，最长 80 个字符。
- 简短说明，最长 240 个字符。
- 分组：计划执行、汇报协作、知识沉淀、其他。
- 默认页面标题，最长 200 个字符。

服务端根据 `sourcePageId` 和 `expectedSourceUpdatedAt` 复制已持久化页面正文。客户端不提交正文作为模板权威内容。未保存页面、非 Markdown 页面或已经变化的来源页面不能生成模板。

### 5.3 独立快照和更新

- 模板保存后与来源页面独立；来源页面后续修改、移动、归档或删除不会改变模板。
- 更新模板内容时，Owner / Admin 从模板管理页选择当前 Space 内一个已保存的 Markdown 页面。
- 服务端再次验证来源页面、权限和 `expectedSourceUpdatedAt`，然后创建新的不可变模板版本。
- 元数据编辑不生成内容版本。
- 已通过旧版本创建的页面保持不变。

### 5.4 归档与恢复

“删除”在产品界面表现为归档：

- 归档模板不再出现在新建页面入口，也不能创建新页面。
- 历史版本和页面来源信息保留。
- Owner / Admin 可以恢复模板。
- 模板在选择后被归档时，创建请求失败并要求重新选择。

## 6. 权限

| 主体 | 查看可用模板 | 使用模板创建页面 | 创建或更新 Space 模板 | 归档或恢复 Space 模板 | 修改系统模板 |
|---|---:|---:|---:|---:|---:|
| Owner | 是 | 是 | 是 | 是 | 否 |
| Admin | 是 | 按现有 `pages:write` 权限 | 是 | 是 | 否 |
| Editor | 是 | 是 | 否 | 否 | 否 |
| Viewer | 页面读取所需时可查元数据 | 否 | 否 | 否 | 否 |
| Agent | 不新增模板能力 | 不通过模板接口 | 否 | 否 | 否 |

所有写入权限必须在服务端操作时重新验证，不能只依赖按钮是否可见。模板使用权限沿用当前 `pages:write` 能力；如果现有 Admin 的页面写入规则与界面角色不一致，实施时以现有授权服务的单一事实为准，不在本功能中扩张 Admin 的页面权限。

## 7. 数据模型

### 7.1 `PageTemplate`

```text
id
scope                 system | space
scopeKey              system 或 spaceId
spaceId               system 时为空，space 时必填
stableKey             系统模板固定 key；Space 模板为稳定 slug
category              planning | reporting | knowledge | other
displayOrder          系统模板固定顺序；Space 模板为空
nameI18n              严格校验的本地化对象
nameKey               Space 内忽略大小写和首尾空白的唯一键
descriptionI18n       严格校验的本地化对象
defaultTitleI18n      严格校验的本地化对象
sourceLocale          Space 模板原始语言；系统模板为空
currentVersion
createdByUserId
updatedByUserId
archivedAt
createdAt
updatedAt
```

系统模板的本地化对象必须同时有 `zh-CN` 和 `en`。Space 模板只保存作者输入的原始语言，并以 `sourceLocale` 作为所有界面语言的回退，不自动翻译。

`scopeKey + stableKey` 唯一，避免 PostgreSQL 可空复合唯一键不能约束系统模板的问题。Space 内模板显示名称还要使用标准化名称键实现忽略大小写和首尾空白的唯一性。

### 7.2 `PageTemplateVersion`

```text
id
templateId
version
contentI18n           严格校验的本地化 Markdown 对象
sourcePageId          可空；来源删除时置空
contentHash
createdByUserId
createdAt
```

`templateId + version` 唯一。每个版本不可变。系统版本同时有中英文正文；Space 版本只有 `sourceLocale` 正文，其他语言回退到该正文。

七个系统模板由服务端代码中的严格 schema 定义提供稳定 key、显示顺序和 `seedVersion`。启动期种子只在 `seedVersion` 增大时创建新的不可变版本并推进 `currentVersion`；不得覆盖旧系统版本，也不得修改任何 Space 模板。

### 7.3 `Page` 来源字段

```text
sourceTemplateId
sourceTemplateVersion
sourceTemplateLocale
```

这些字段只记录创建来源，不建立实时内容关联。模板归档不清除页面来源；模板实体不得在仍被页面引用时物理删除。

三个来源字段必须同时为空或同时有效。数据库使用 `sourceTemplateId + sourceTemplateVersion` 指向 `PageTemplateVersion(templateId, version)` 的复合外键，保证页面不能记录不存在的模板版本。

## 8. API

### 8.1 模板接口

```text
GET    /spaces/:spaceId/page-templates
GET    /spaces/:spaceId/page-templates/:templateId
POST   /spaces/:spaceId/page-templates
PATCH  /spaces/:spaceId/page-templates/:templateId
POST   /spaces/:spaceId/page-templates/:templateId/versions
DELETE /spaces/:spaceId/page-templates/:templateId
POST   /spaces/:spaceId/page-templates/:templateId/restore
```

列表默认只返回有效模板的元数据和当前版本号，不返回正文；管理页通过显式参数读取已归档模板。所有列表有固定分页上限和稳定排序：系统模板按定义顺序，Space 模板按 `updatedAt desc, id desc`。

创建 Space 模板的请求包含 `sourcePageId`、`expectedSourceUpdatedAt`、名称、说明、分组、默认标题和 `locale`。更新内容版本的请求包含 `sourcePageId`、`expectedSourceUpdatedAt` 和 `expectedCurrentVersion`。元数据更新、归档和恢复携带 `expectedUpdatedAt`，并发变化返回冲突，不做最后写入获胜。

### 8.2 使用模板创建页面

沿用 `POST /pages`，扩展可选字段：

```json
{
  "spaceId": "space-id",
  "title": "周报 2026年第35周",
  "parentId": "optional-parent-id",
  "templateId": "template-id",
  "templateVersion": 3,
  "templateLocale": "zh-CN"
}
```

规则：

- `templateId`、`templateVersion`、`templateLocale` 要么同时存在，要么同时不存在。
- 使用模板时拒绝同时提交 `content` 或非 Markdown `format`。
- 服务端验证模板是系统模板或属于当前 Space、模板未归档、版本存在、语言可解析、调用者拥有当前 Space 的 `pages:write`。
- 服务端从请求指定的不可变版本复制 Markdown；不会静默切换到较新版本。
- 不传模板时保持现有空白页面和显式正文创建行为。
- Agent 的现有页面提案继续提交明确正文；Agent 请求只要包含任一模板来源参数，服务端就明确拒绝，不能退化为空正文提案。

## 9. 约束与异常处理

- 单个 Space 最多 100 个有效自定义模板。
- 模板正文沿用页面正文的 200,000 字符上限。
- 模板名称标准化后重复返回可定位到名称字段的业务错误。
- 来源页面不存在、已归档、非 Markdown 或 `updatedAt` 不匹配时拒绝保存或更新模板。
- 更新来源正文的 `contentHash` 与当前模板版本相同时返回当前版本，不制造无内容变化的新版本。
- 并发元数据或内容更新返回版本冲突；客户端保留输入并提供重新加载。
- 权限在弹窗打开后被撤销时，服务端拒绝操作，客户端不显示乐观成功。
- 系统模板缺少请求语言时回退 `en`；Space 模板回退 `sourceLocale`；任何翻译键或未解析占位符都不得写入页面。
- 模板列表失败时空白页面仍可创建；模板创建失败不清空标题和父页面。

## 10. 测试与验收

### 10.1 服务端

- 数据库迁移、唯一约束、来源外键和不可变版本测试。
- 七个系统模板的 key、版本、顺序、中英文元数据、正文和 Markdown 长度测试。
- Owner / Admin 管理、Editor 只用、Viewer 禁止、Agent 禁止管理测试。
- 跨 Space 模板 ID、已归档模板、错误版本、错误语言、正文混传和非 Markdown 来源测试。
- `expectedUpdatedAt`、`expectedCurrentVersion` 和并发更新冲突测试。
- 从指定版本创建后，页面正文和三个来源字段完全匹配；模板后续更新或归档不改变页面。
- 模板列表分页和稳定排序测试。

### 10.2 客户端

- 两步切换、返回、筛选、默认选中空白页面和默认标题插值。
- 模板列表失败后的重试与空白页面降级。
- 创建成功跳转、创建失败保留表单、重复提交禁用。
- Owner / Admin 管理入口和 Editor / Viewer 隐藏规则。
- 脏页面、非 Markdown 页面和并发来源变化的保存模板提示。
- 中英文文案和 Space 模板原语言回退。
- Modal 焦点陷阱、Escape、遮罩、关闭后焦点恢复和键盘选择模板。

### 10.3 浏览器验收

- 中文和英文各完成一次“系统模板 → 创建页面 → 编辑器看到正文”。
- Owner 创建、更新、归档、恢复一个 Space 模板；Editor 使用该模板；Viewer 无创建入口。
- 模板更新后验证旧页面未改变，新页面使用新版本。
- 桌面和 390×844 视口无横向溢出，console 无新增 error / warning。
- 原有空白页面创建和父页面选择回归通过。

## 11. 实施边界

实施应优先复用 `ModalDialog`、`SpaceNav`、现有权限服务、页面创建事务、修订写入和中英文 `LanguageContext`。模板域保持独立，不与协作工作流的 `CollaborationTemplate` 混用：页面模板只生成普通 Markdown 页面，协作模板生成多 Agent 运行，两者在权限、版本和生命周期上没有可互换关系。
