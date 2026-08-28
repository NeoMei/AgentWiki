# AgentWiki Space 目录层级设计

**日期：** 2026-08-28

**状态：** 已完成产品设计，等待用户审阅

**范围：** AgentWiki Server、Web Client、Sync Protocol、Local Sync、Obsidian 插件、MCP/ChangeSet

## 1. 背景

AgentWiki 目前只有 Page，没有独立 Folder。现有 `Page.parentId` 可以把页面挂到另一个页面下面，Web 端也能渲染和拖拽页面树，但这是一棵“页面包含页面”的逻辑树，不是 Obsidian 的文件夹树：

- Page 既是正文又充当父节点，不能表达空目录。
- Page 创建时的同步路径固定分配在 `pages/标题.md`，`parentId` 不决定文件系统路径。
- 目录不能单独创建、重命名、移动、删除或恢复。
- Sync Protocol v1 只有 Page 快照和 Page 增量，没有 Folder 身份或空目录。
- 页面改名会分配新 `syncPath`，但当前没有旧路径别名，目录化后会放大旧 Wiki 链接失效问题。

目标是让每个 Space 拥有一棵与 Obsidian 文件树语义一致的目录树，同时保持 Page ID、权限、ChangeSet、模板、搜索、图谱和同步链路的既有边界。

## 2. 目标

1. Folder 是一等实体，可为空、可嵌套、可移动、可重命名、可递归软删除并整体恢复。
2. Page 归属于 Folder，页面不再充当目录；根目录用 `folderId = null` 表示。
3. Web 与 Obsidian 在受管理根 `AgentWiki/pages/` 下双向同步同一棵目录树，包括空目录。
4. Folder 使用稳定 ID；路径变化不改变 Folder ID、Page ID 或已建立的图谱关系。
5. 人类和授权 Agent 通过同一事务服务、权限模型、ChangeSet 与审计链路修改目录。
6. `[[页面]]` 与 `[[目录/页面]]` 都有确定的解析规则，页面移动后旧路径可以受限回溯。
7. 旧 `Page.parentId` 数据确定性迁移为 Folder，不丢页面、不改页面标题、不改变 Page ID。

## 3. 非目标

- 首版不提供 Folder 级 ACL；所有目录继承 Space 权限。
- Folder 不包含 Markdown 正文，也不自动生成 `index.md` 或 `README.md`。
- 首版不允许把同步根配置到 Vault 任意位置；只管理 `AgentWiki/pages/`。
- 不把 Folder 加入知识图谱节点；图谱仍以 Page 和既有知识实体为核心。
- 不自动批量重写所有 Markdown 中的旧路径链接。
- 不使用 Folder 作为附件公开路径或授权边界；附件仍按 Space 权限和既有受保护存储处理。
- 不引入通用 `ContentNode` 多态表。

## 4. 已确认的产品决策

| 主题 | 决策 |
| --- | --- |
| Folder 身份 | 独立一等实体，有稳定 ID |
| 树语义 | 最终只有一棵 Folder 树；Page 是叶子 |
| 权限 | 继承 Space，不设 Folder ACL |
| Obsidian | Folder 完整双向同步，空目录也同步 |
| 删除 | 整棵目录原子进入回收站，可整体恢复 |
| 同步根 | 固定在受管理的 `AgentWiki/pages/` |
| Folder 正文 | 无正文；允许 `项目.md` 与 `项目/` 并存 |
| 命名 | NFC、忽略大小写的同级可移植名称唯一 |
| 旧树迁移 | Page 与代表自己的同名 Folder 并列；旧子 Page 迁入父 Page 对应的 Folder |
| 并发 | 同一 Folder 并发改名/移动显式冲突，不使用 LWW |
| Agent | 经授权可完整创建、重命名、移动、删除 Space 内 Folder |
| Agent 执行 | 沿用 ChangeSet、人工审核和 Publisher 自动发布规则 |

## 5. 领域模型与不变量

### 5.1 Folder

建议新增 Prisma `Folder` 模型，字段至少包括：

```text
id                    String      主键
spaceId               String      所属 Space
parentId              String?     父 Folder；null 表示受管理根
name                  String      用户可见名称，1..200 字符
nameKey               String      NFC + Unicode case-fold 后的唯一键
sortOrder             Int         同类型兄弟节点中的顺序
syncPath              String      缓存的规范相对路径，如 pages/项目
syncPathKey           String      跨平台折叠后的路径键
createdByUserId       String?
createdByAgentId      String?
sourceChangeSetId     String?
lastModifiedByUserId  String?
lastModifiedByAgentId String?
lastModifiedAt        DateTime
deletionBatchId       String?
deletedAt             DateTime?
createdAt             DateTime
updatedAt             DateTime
```

Folder 使用 `parentId` 邻接树作为事实来源，`syncPath`/`syncPathKey` 是在事务内同步维护的查询缓存。任何服务都不得只改路径而不改父关系，或只改父关系而不重算路径。

数据库约束：

- 外键必须保证父 Folder 与子 Folder 属于同一 Space；该约束由事务服务验证，数据库触发器或复合外键作为最终防线。
- 活跃根目录使用 `(spaceId, nameKey)` 部分唯一索引。
- 活跃非根目录使用 `(spaceId, parentId, nameKey)` 部分唯一索引。
- 活跃 Folder 的 `(spaceId, syncPathKey)` 唯一。
- 最大深度 32；完整路径最多 1024 UTF-8 字节；单段最多 255 UTF-8 字节。
- 同一 Space 最多 10,000 个活跃 Folder。
- 任何目录不能成为自身或后代的父目录。

Sync Protocol 拆分共享校验器：`validatePortableDirectoryPath` 校验 Folder 路径，`validatePortableMarkdownPath` 校验 Page 路径；两者复用同一套段字符、保留名、NFC、case-fold 和长度规则。不得把当前“末段必须是 `.md`”的 Page 校验器直接用于 Folder。

### 5.2 Page

Page 新增 `folderId String?`。`folderId = null` 表示 Page 位于 `pages/` 根下。Page 的 `syncPath` 由 Folder 路径和安全 Markdown basename 共同分配：

```text
Folder: pages/项目/周报
Page:   pages/项目/周报/2026-W35.md
```

Page 与 Folder 使用不同文件系统名称空间，因此允许同时存在 `pages/项目.md` 与 `pages/项目/`。Page 标题仍可重复；同目录文件名冲突继续使用确定性的 ` (2)`、` (3)` 后缀分配。

旧 `Page.parentId` 在迁移兼容期内只读，禁止新代码把 Page 当作父节点。迁移验证通过并完成客户端切换后移除该字段和旧 reorder 契约。

### 5.3 Space tree revision

Space 增加单调递增的 `contentTreeRevision`。创建、移动、重命名、排序、删除、恢复 Folder，以及改变 Page 所属 Folder，都必须在持有 Space advisory lock 的事务中推进该 revision。

客户端写操作同时携带：

- `expectedTreeRevision`
- 目标 Folder 或 Page 的 `expectedUpdatedAt`

任一不匹配均返回显式冲突，不能部分执行。

### 5.4 PagePathAlias

新增 `PagePathAlias`：

```text
id         String
spaceId    String
pageId     String
path       String
pathKey    String
createdAt  DateTime
expiresAt  DateTime?
```

Page 改名、移动或其祖先 Folder 路径变化时，旧规范路径写入别名。解析时当前 Page 路径优先于别名；别名冲突返回歧义。每页最多保留最近 20 个别名，后台清理只删除超额且未被活跃关系引用的历史记录。

`PagePathAlias` 使用 `(spaceId, pathKey, pageId)` 唯一约束去重，但不把 `(spaceId, pathKey)` 设为唯一，因为历史上不同 Page 可能先后占用同一路径；这种情况必须保留为可解释的歧义。

### 5.5 删除批次

新增 `ContentDeletionBatch`，记录 `id`、`spaceId`、根 Folder ID、发起主体、删除时 tree revision、影响数量、影响集合哈希、创建时间和恢复时间。递归删除为 Folder、后代 Folder 和后代 Page 写入同一个 `deletionBatchId`。恢复按批次执行，默认要求原位置可用。若名称或路径已被占用，默认失败；调用方可明确选择：

- 恢复到受管理根；或
- 为冲突的最上层 Folder 指定新名称。

系统不得静默覆盖或静默改名。

## 6. 统一事务服务

新增 `ContentTreeService`，所有 Web、MCP/ChangeSet、Sync 和迁移代码都调用它。禁止控制器、ReviewService 或 Local Sync 各自实现一套树修改规则。

每次写操作的固定步骤：

1. 验证身份、Space scopes 和角色。
2. 开启 PostgreSQL 事务并获取现有 Space advisory lock。
3. 校验 `expectedTreeRevision`、目标版本和活跃状态。
4. 用递归 CTE 读取目标祖先链或后代子树，校验循环、深度、数量和路径预算。
5. 预分配所有 Folder/Page 新路径和 `pathKey`，在写入前完成冲突检查。
6. 批量写 Folder、Page、PagePathAlias、删除批次和审计信息。
7. 推进 Space content tree revision 和 Sync Protocol revision。
8. 事务提交后再触发搜索重建、图谱维护和非关键后台清理。

单次递归操作最多影响 10,000 个 Folder/Page。超限在任何写入前失败，不允许分批暴露半棵迁移树。

## 7. Server API

### 7.1 读取统一树

```http
GET /spaces/:spaceId/content-tree?parentFolderId=:id&cursor=:cursor&take=100
```

接口只返回指定 Folder 的直接子项，`parentFolderId` 省略时返回根目录。`take` 范围为 1..200，使用稳定 cursor 分页；Folder 节点携带 `hasChildren`。客户端展开 Folder 时懒加载，不允许一次返回整个 10,000 节点 Space。

响应：

```json
{
  "spaceId": "space-id",
  "treeRevision": "42",
  "parentFolderId": null,
  "data": [
    {
      "kind": "folder",
      "id": "folder-id",
      "name": "项目",
      "path": "pages/项目",
      "updatedAt": "2026-08-28T00:00:00.000Z",
      "hasChildren": false
    },
    {
      "kind": "page",
      "id": "page-id",
      "folderId": null,
      "title": "项目",
      "path": "pages/项目.md",
      "updatedAt": "2026-08-28T00:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

树始终先列 Folder，再列 Page；同类型节点按 `sortOrder`、创建时间和 ID 确定性排序。

### 7.2 Folder 写接口

```http
GET    /spaces/:spaceId/folders?query=:query&cursor=:cursor&take=100
POST   /spaces/:spaceId/folders
PATCH  /spaces/:spaceId/folders/:folderId
PATCH  /spaces/:spaceId/content-tree/move
GET    /spaces/:spaceId/folders/:folderId/delete-impact
DELETE /spaces/:spaceId/folders/:folderId
POST   /spaces/:spaceId/folders/:folderId/restore
```

创建参数：`name`、`parentId`、`expectedTreeRevision`。

Folder 更新参数：`name`、`expectedUpdatedAt`、`expectedTreeRevision`。

树移动参数：`kind`、`id`、`targetParentFolderId`、可选同类型 `beforeId`、`expectedUpdatedAt`、`expectedTreeRevision`。

删除参数：`expectedUpdatedAt`、`expectedTreeRevision`、`expectedImpactHash`。

恢复参数：`deletionBatchId`、`expectedTreeRevision`、`mode` 与可选新名称。

`content-tree/move` 每次只移动一个 Folder 或 Page；`beforeId` 必须是目标父目录下相同 `kind` 的活跃兄弟节点。服务端在 Space 锁内分配顺序并按需压缩同类型兄弟 `sortOrder`，客户端不需要加载或回传完整目录。Folder 列表接口供“移动到…”、页面创建目录选择器和 MCP 使用，同样是 cursor 分页，不能无界返回。`delete-impact` 返回后代 Folder/Page 数量、根 Folder 版本和影响集合哈希；哈希由规范排序的对象 ID、类型和版本计算。DELETE 必须回传该哈希，避免预览后子树发生变化仍被递归删除。

### 7.3 Page API 兼容

Page 创建和更新使用 `folderId`。兼容期内：

- 不允许同时提交 `folderId` 与 `parentId`。
- 旧 `parentId` 只在迁移映射仍存在时转换为对应 Folder ID。
- 无法唯一转换时返回 `PAGE_PARENT_DEPRECATED`，不猜测目标。
- 新客户端不发送 `parentId`。

现有页面详情、版本、模板、搜索和图谱 API 保持 Page 语义；新增 `folderId` 和规范 `path` 字段。

## 8. 权限、Agent 与 ChangeSet

### 8.1 人类角色

Folder 不设独立 ACL，沿用 Space 角色：

| 操作 | Owner | Admin | Editor | Viewer |
| --- | --- | --- | --- | --- |
| 读取 Folder | 是 | 是 | 是 | 是 |
| 创建/改名/移动/排序 | 是 | 否 | 是 | 否 |
| 递归删除/恢复 | 是 | 否 | 是 | 否 |

### 8.2 Agent scopes

新增：

- `folders:read`
- `folders:write`
- `folders:delete`

Agent 只能操作其 Authorization 绑定的 Space。获得完整 scopes 的 Agent 可以创建、重命名、移动、排序、删除和恢复 Folder，但不能跨 Space，也不能绕过 ChangeSet。

升级时不得给既有 Authorization 静默扩权。旧 Grant 保持原 scopes；Owner 在授权界面明确增加 Folder scopes。用于层次化文档写作的新 Agent 模板可以请求三项 scopes，但仍需 Owner 确认后生效。

### 8.3 MCP

新增 MCP tools：

- `list_folders`
- `propose_folder_change`
- `propose_document_tree`

`propose_folder_change` 的动作枚举为 `create | rename | move | reorder | delete | restore`，用于独立的 Folder 生命周期操作。已经发布的 Folder 可由后续 `propose_page` 通过稳定 `folderId` 引用；同一提案内同时创建 Folder 和 Page 时使用下述 `propose_document_tree`。

为保证普通 Editor Agent 也能一次提议完整层次，而不必等待 Folder 审核后才能继续，`propose_document_tree` 接受最多 100 个有界操作和最多 2 MiB 规范化 Markdown：

- Folder create 操作声明 ChangeSet 内唯一 `folderRef`，父级可引用已存在 `folderId` 或本批次更早/更浅的 `parentFolderRef`。
- Page create 操作可用 `folderRef` 指向同一 ChangeSet 中尚未落库的 Folder。
- 服务端先验证引用唯一性、依赖闭包、深度、路径、总量和权限，再把整批写入一个 ChangeSet。
- 发布时在同一个 Space 锁事务中按拓扑顺序创建 Folder、解析 `folderRef`、创建 Page 并生成一次 tree/sync revision；任一步失败则全部回滚。
- `list_pages`、`get_page` 和 Page 提案响应增加 `folderId` 与规范 `path`，便于 Agent 在后续调用中复用已存在目录。

执行规则与页面提案一致：

- 普通 Editor Agent 生成待审核 ChangeSet。
- Publisher Agent 只有在 Agent mode、Space policy、Grant 和对应 Folder scope 同时允许时自动发布。
- `delete` 还要求 `folders:delete`，并在 ChangeSet 中固定受影响数量、影响哈希和 ID 摘要。
- 审核时若 tree revision 或影响哈希已变化，ChangeSet 失效并要求重新生成。
- 文档树提案必须在审核界面显示将创建的目录树、页面数量、总 Markdown 字节数和所有外部已有 Folder 引用。

## 9. Sync Protocol v2

### 9.1 Folder 数据

Sync Protocol v2 新增：

```text
SyncFolder {
  folderId
  parentFolderId
  path
  name
  updatedAt
}
```

Sync Protocol v2 的 `SyncPage` 增加 `folderId`；`path` 仍是本地落盘的规范依据。快照同时包含按规范顺序排列的 Folder 和 Page。revision content hash、manifest byte length、`folderCount` 和 `pageCount` 都覆盖并明确区分两类对象；所有大整数仍使用十进制字符串传输。

增量操作增加：

```text
folder_upsert
folder_archive
folder_restore
page_upsert
page_archive
```

仅支持 v1 的客户端在看到 v2 Space 时返回 `SYNC_CLIENT_UPGRADE_REQUIRED` 并停止写入，不能忽略 Folder 后继续推送扁平 Page。

### 9.2 本地身份映射

Obsidian 插件在私有 `.agentwiki/` 状态中原子保存 Folder ID 与相对路径映射，不在每个目录中写隐藏 marker 文件。

- 插件运行时通过文件事件配对目录改名和移动。
- 冷启动先检查原映射路径，再用唯一的后代 Page ID 特征恢复 Folder 身份。
- 空目录离线改名且无法唯一识别时产生显式冲突：用户选择“原 Folder 改名”或“删除旧 Folder 并创建新 Folder”。
- 空目录本身是快照和增量对象，即使没有 `.md` 也必须创建和推送。

### 9.3 本地应用顺序

一次 Pull 固定按以下顺序应用：

1. 从浅到深创建 Folder。
2. 应用 Folder 改名和移动。
3. 写入或移动 Page。
4. 删除 Page。
5. 从深到浅删除 Folder。
6. 原子提交私有 Folder 映射和本地 revision。

失败时保留原目录、原映射和可重试日志。不得把中间状态标记为已同步。

### 9.4 文件系统安全

所有操作限制在 `AgentWiki/pages/` 的规范真实目录中。每一级路径都必须：

- 拒绝符号链接和路径穿越；
- 重新验证目录设备/ inode 身份，防止检查后替换；
- 使用跨平台 `pathKey` 检测大小写和 Unicode 折叠冲突；
- 遵守 255 字节段长、1024 字节总长和 Windows 保留名规则；
- 不读取、移动或删除受管理根之外的文件。

## 10. Web 交互

### 10.1 ContentTree

现有 `PageTree` 升级为带判别联合类型的 `ContentTree`。首屏只加载根节点，展开 Folder 时通过 cursor 分页加载直接子项：

- Folder：文件夹图标、展开/折叠、选择、改名、移动、删除和新建子项。
- Page：叶子节点，不再接收“拖入页面”。
- Page 可拖入 Folder 或根目录。
- Folder 可拖入其他 Folder 或根目录，客户端预检查自身/后代循环，服务器再次强制校验。

树的文件系统语义为 Folder 优先、Page 随后。Web 可保留同类型手工排序，但不承诺 Obsidian 复现跨类型自定义顺序。

### 10.2 创建和浏览

“新建”按钮改为菜单：

- 新建页面
- 新建目录

从 Folder 上下文发起时，默认 `folderId` 为当前目录。模板创建页面继承当前 Folder；用户仍可在新建页面对话框更换目录。

选择 Folder 后显示直接子目录和页面，并显示可点击面包屑。搜索结果、模板来源、回收站和冲突界面都显示完整目录路径，避免同名页面无法辨认。

### 10.3 删除和恢复

删除非空 Folder 前必须展示：

- 后代 Folder 数量；
- 后代 Page 数量；
- 是否包含当前打开页面；
- 操作将进入回收站而不是立即物理删除。

确认后回传 `expectedImpactHash`。回收站按 deletion batch 展示并整体恢复。

### 10.4 可访问性和移动端

- Folder 展开按钮、树项、菜单和拖拽替代操作都有可访问名称。
- 键盘可执行展开、折叠、上移、下移、移入和移出。
- 390px 宽度下路径可以横向滚动或中间省略，操作按钮不可被挤出视口。
- 不把拖拽作为唯一移动方式；提供“移动到…”对话框。

## 11. Markdown Wiki 链接与嵌入

解析规则：

1. `[[页面]]` 优先匹配当前 Page 所在 Folder 的同名 Page。
2. 若同目录无匹配，则匹配 Space 内唯一标题。
3. 仍有多个候选时返回歧义和候选路径，不按更新时间或数据库顺序静默选择。
4. `[[项目/周报]]` 按 `AgentWiki/pages/` 下的规范路径匹配 Page。
5. 当前规范路径优先于 `PagePathAlias`；别名命中多个 Page 时返回歧义。

编辑器插入链接时：标题唯一使用短链接；标题重复则写最短可区分路径。图片、Markdown 页面嵌入、标题片段和块引用沿用相同的 Folder-aware 资源解析入口，继续遵守既有批量、递归和安全预算。

页面或祖先 Folder 移动后不批量改写 Markdown；稳定 Page ID、`PagePathAlias` 和图谱关系保证旧路径在受限历史内继续工作。

## 12. 错误契约

新增稳定业务错误码：

| 错误码 | 含义 |
| --- | --- |
| `FOLDER_NOT_FOUND` | Folder 不存在、已删除或不属于当前 Space |
| `FOLDER_NAME_CONFLICT` | 同级可移植名称键冲突 |
| `FOLDER_INVALID_NAME` | 名称包含不可移植字符或保留名 |
| `FOLDER_CYCLE` | 移动会形成循环 |
| `FOLDER_DEPTH_LIMIT` | 超过 32 层 |
| `FOLDER_COUNT_LIMIT` | Space Folder 数超过 10,000 |
| `FOLDER_MUTATION_LIMIT` | 单次递归影响对象超过 10,000 |
| `FOLDER_PATH_TOO_LONG` | 段或完整路径超限 |
| `CONTENT_TREE_CONFLICT` | tree revision 或对象版本不匹配 |
| `FOLDER_DELETE_IMPACT_CHANGED` | 删除预览后的子树已变化 |
| `FOLDER_RESTORE_CONFLICT` | 原恢复位置已被占用 |
| `PAGE_PARENT_DEPRECATED` | 旧 parentId 无法安全转换 |
| `SYNC_CLIENT_UPGRADE_REQUIRED` | v1 客户端不能写 v2 Folder Space |
| `FOLDER_SYNC_IDENTITY_CONFLICT` | 本地 Folder 身份无法唯一恢复 |

错误响应不暴露其他 Space 的 Folder ID、路径或候选名称。

## 13. 审计

每个 Folder 变更写入 AuditLog，至少包含：

- 人类或 Agent 主体；
- Authorization、Credential、Run 和 ChangeSet（如适用）；
- 动作类型；
- Folder ID；
- 旧/新父 Folder ID；
- 旧/新规范路径；
- 影响 Folder/Page 数量；
- tree revision 前后值；
- 删除批次或恢复批次 ID。

审计正文不保存页面内容或本地绝对 Vault 路径。

## 14. 迁移与发布顺序

### 14.1 数据库扩展

1. 新增 Folder、PagePathAlias、删除批次字段、`Page.folderId` 和 Space tree revision。
2. 保持旧字段可读，但新 Writer 必须通过统一事务服务。
3. 迁移命令先运行只读 preflight，输出每个 Space 的 Page 数、待建 Folder 数、名称清洗、名称冲突、路径变化和拒绝原因，并计算输入快照哈希。
4. 部署时先停止所有旧 API/Worker Writer，再执行带唯一 migration batch ID 的回填；禁止旧进程在 Folder 迁移期间写 Page 树。
5. 回填按 batch ID 和输入哈希幂等；重复运行不得创建重复 Folder、别名或 revision。正式切换前失败可回滚新增记录并恢复旧 Writer，切换后只允许前向修复。

### 14.2 旧 Page 树回填

对每个 Space 在 advisory lock 内：

1. 读取完整活跃 Page 父子图并拒绝循环、跨 Space 父引用和孤儿。
2. 对每个拥有子 Page 的父 Page，在父 Page 所在目录创建同名 Folder。迁移专用 `safeFolderName` 使用与在线 Folder 相同的可移植规则，把非法字符折叠为空格、清理尾部点/空格，并为保留名使用确定性安全名称；所有清洗都写入迁移报告。
3. 对每个 Page P：若 P 原来是根 Page，则仍位于 `pages/`；若 P 原来是另一个 Page 的子 Page，则把 P 放入其旧父 Page 对应的 Folder。Page ID 和标题不变。
4. 如果 P 自己还有子 Page，则在 P 当前所在 Folder 内创建与 P 并列的同名 Folder。递归重复，形成 Folder 链。根层父 Page 因此保留原路径；既是子 Page 又是父 Page 的记录会按旧层级移动。
5. 名称冲突按确定性的 ` (2)`、` (3)` 分配 Folder 名称，并写入迁移报告。
6. 为每个改变路径的 Page 写入旧 `syncPath` 别名。
7. 生成包含 Folder 的首个 v2 revision。

示例：

```text
迁移前页面树：
项目.md
└── 周报.md
    └── 第35周.md

迁移后文件树：
项目.md
项目/
├── 周报.md
└── 周报/
    └── 第35周.md
```

### 14.3 切换与收缩

1. 发布支持 v2 的 Server、Local Sync 和 Obsidian 插件。
2. Web 切换到 `content-tree`；MCP 公布 Folder tools/scopes。
3. 对真实测试 Space 做 Pull/Push 和冲突验收。
4. 在所有 Writer 不再使用 `Page.parentId` 后，移除旧 API、索引和字段。

## 15. 测试矩阵

### 15.1 单元与属性测试

- NFC/case-fold、Windows 保留名、非法字符、尾部点/空格。
- 同级唯一、同名 Page/Folder、确定性后缀。
- 祖先/后代、循环、深度 32/33、路径 1024/1025 字节。
- PagePathAlias 当前路径优先、歧义、20 条保留上限。
- Folder-first 树排序和判别联合解析。
- 随机树移动属性测试：操作后无循环、无孤儿、路径与 parent 链一致。

### 15.2 真实 PostgreSQL

- 两个事务并发创建同名 Folder，只有一个成功。
- 并发重命名、移动、排序、删除和恢复正确使用 Space lock。
- 递归 CTE 在 10,000 节点边界内完成；10,001 在写入前失败。
- 任一约束或 revision 冲突使 Folder、Page、alias、revision 和 audit 全部回滚。
- 删除影响哈希阻止 TOCTOU 递归删除。
- 查询计划没有按节点 N+1 往返。

所有数据库测试只运行在显式专用测试数据库和唯一 schema 中，结束后验证 schema、临时目录和端口清零。

### 15.3 权限与 Agent

- Owner/Admin/Editor/Viewer 权限矩阵。
- `folders:read/write/delete` 的每一种缺失组合。
- 升级后旧 Authorization 不自动获得 Folder scopes；Owner 明确授权后才生效。
- 跨 Space Folder ID 不可读取、探测或变更。
- Editor Agent 待审核、Publisher Agent 自动发布、tree revision 过期后 ChangeSet 失效。
- Agent 递归删除必须固定影响摘要，不能审核后扩大范围。
- `propose_document_tree` 的 `folderRef` 重复、缺失、循环、跨 Space 外部引用、101 个操作和超过 2 MiB 内容全部 fail-closed；合法批次按拓扑原子发布。

### 15.4 Sync Protocol v2 与 Local Sync

- Folder snapshot/delta/hash/分页和确定性排序。
- 空目录 Pull/Push、在线改名、离线可识别移动、离线空目录歧义。
- v1 客户端 fail-closed。
- 应用中断、断电恢复、映射原子写入和重复 replay 幂等。
- symlink、路径穿越、大小写折叠、Unicode、超长路径和根外删除拒绝。
- 创建父目录、移动页面、深到浅删除顺序可执行。

### 15.5 Web 与浏览器

- 新建多层 Folder、空 Folder、同名 Page/Folder。
- 在 Folder 中从系统模板或 Space 模板创建 Page。
- Page/Folder 拖拽、移动对话框、非法循环、并发回滚。
- 面包屑、重名搜索结果、删除影响确认、批次恢复和恢复冲突。
- `[[页面]]`、`[[目录/页面]]`、历史别名、图片和 Markdown 嵌入。
- 键盘操作、屏幕阅读器名称和 390px 移动端布局。

### 15.6 真实 Obsidian 验收

在一次隔离的真实 Vault/Space 中完成：

1. Web 创建空 Folder，Obsidian Pull 后可见。
2. Obsidian 创建、改名、移动、删除 Folder，Push 后 Web 一致。
3. 两端同时改同一 Folder，出现可选择的冲突而非 LWW。
4. 创建层次化模板页面和 Agent 生成的成套文档。
5. 打开短 Wiki 链接、路径 Wiki 链接、旧路径别名、公式、Mermaid、图片与 Markdown 嵌入。
6. 重启 Obsidian 后映射和 revision 仍收敛。

## 16. 完成标准

本功能只有在以下条件全部成立时才算完成：

- 数据模型、统一事务服务、API、Web、MCP、Sync Protocol v2、Local Sync 和 Obsidian 插件全部实现。
- 旧 Page 树迁移在空库、典型数据、冲突数据和回滚路径上通过真实 PostgreSQL 验证。
- 完整前后端、协议包、本地同步包、浏览器和真实 Obsidian 验收全部通过。
- 独立代码、安全和需求审查没有 Critical、Important 或值得修复的 Minor。
- 分别报告本地分支、GitHub、sync npm 包、Obsidian 插件、服务器部署和生产验证状态；任何一项不能由其他绿色检查替代。
