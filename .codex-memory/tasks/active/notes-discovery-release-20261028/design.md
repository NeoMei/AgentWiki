# 已确认设计

- 笔记面板以“当前页面 / 全部笔记”分离上下文。默认当前页，当前页继续使用现有 usePersonalNotes 与 PersonalNotesPanel；既有高亮、草稿隔离、作者修改、Agent 待发送流程不变。
- 全部笔记默认本空间、全部状态、全部作者，支持切所有有权限空间、我写的和 @我；检索正文、原引用和来源页名称，按最近更新降序，分页。
- 全部视图保留当前页名称、未解决数量和“回到本页”摘要，不固定整个当前笔记列表。
- 所有结果带空间/页面/目录来源。打开后跳来源页并选中笔记，允许返回原检索；失效原文只影响定位，不影响打开卡片。
- 空间导航新增“笔记”入口，可在未打开具体页面时找笔记；共享笔记语义和原作者修改边界保留。
- 跨页检索由新增只读服务端聚合查询完成，计数与分页同样过滤权限、删除页/空间/笔记；不逐页请求，也不把跨页结果注入单页写队列。
- 蓝色 logo 一并发布，旧品牌资源保留。本轮 Web/API 升到下一可用版本，npm/protocol 无变更时不发新包。

## 前后端契约

`GET /api/page-notes?spaceId=<optional>&query=<optional>&author=all|me|mentioned&status=all|open|resolved&cursor=<optional>&limit=20`

- 省略 spaceId 表示所有当前有访问权限的空间。author 默认 all，status 默认 all；open 表示 status != resolved。query 最大 200 字符；limit 默认20、最大50。非法参数返回400。
- 返回 `{ notes, total, nextCursor }`。total 为同一权限/搜索/筛选下的总数；cursor 有界且稳定排序 `(updatedAt DESC, id DESC)`，最后一页 nextCursor=null。
- 每条 notes 兼容现有 PageNoteDto 字段（id/spaceId/pageId/body/target/status/author/canEdit/createdAt/updatedAt/recipients），附加 `page: { id, title, folderPath: string[] }`、`space: { id, name }`。前端检索页不直接执行修改，canEdit 沿用服务端作者语义。
- 对人类/PAT/Agent 做实时鉴权；搜索与计数不能泄漏已撤权对象。只读角色仍能检索其可读共享笔记。

## 前端模块契约

- 新目录 `apps/client/src/features/page-notes/`。
- `NotesBrowser` 导出 props `{ spaceId: string; currentPage?: { id: string; title: string; openCount: number }; onReturnToCurrent?: () => void; embedded?: boolean }`。使用当前账号隔离状态，忽略过期请求，失败有重试；筛选/查询重置 cursor。页面跳转需携带安全的检索返回上下文。
- `NotesPage` 导出 React 组件，路由 `/spaces/:id/notes`，从 useParams 取得 id，复用 NotesBrowser。
- 前端 API DTO 与以上服务端契约一致；不要将不同页数据交给现有 fromPageNote(scope)。
- 根代理负责现有阅读/编辑面板的双视图封装、路由与空间导航、深链和返回导航；前端代理仅改新目录，后端代理仅改 server/page-notes 与必要 Prisma 索引。
