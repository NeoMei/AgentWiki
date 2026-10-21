# 页面笔记协作人和消息通知设计

## 目标

在页面笔记创建时允许作者选择多个同一 Space 内的人类协作人。笔记保存后，为每个被选协作人生成一条持久化的未读消息通知。通知入口位于全局导航栏，显示未读数和最近通知；点击通知后进入对应页面，自动打开页面笔记栏并定位到该笔记的原文。

本次范围只覆盖页面笔记的协作人通知，不改变 Agent 协作运行事件，也不把通知发送到 Agent。被通知人仍须拥有该页面当前的读取权限；选择协作人不会扩大页面权限。

## 术语和边界

- **协作人**：创建页面笔记时由作者明确选中的、属于该 Space 的人类成员。服务端以 `SpaceMember` 为准，不信任客户端提交的姓名或邮箱。
- **消息通知**：收件人可见的持久化未读/已读记录，引用页面和页面笔记。它是用户消息状态，不是协作运行的 Redis 事件。
- 通知只在笔记第一次成功创建时产生。当前笔记界面没有协作人编辑器，因此本次不提供对已有笔记增删协作人的更新入口。
- 当前用户不默认收到自己创建笔记的通知；客户端可以提交自己，但服务端会过滤掉作者本人。
- 只展示和选择 `type === "human"` 的 Space 成员；Agent 成员不进入本次收件人列表。

## 方案

### 数据模型

新增通用 `UserNotification` 模型，保存：

- `id`、`recipientUserId`、`actorUserId`、`spaceId`、`pageId`、`pageNoteId`
- `type`（本次为 `page_note_mention`）
- `title`、`body` 或受限长度的正文摘要、`payload`（保存页面标题和原文片段等展示字段）
- `createdAt`、`readAt`

为页面笔记新增 `PageNoteRecipient` 关系表，保存 `noteId`、`userId`、`createdAt`，并对 `[noteId, userId]` 建唯一约束。它记录笔记实际通知了谁，避免把通知收件人列表塞进 JSON，也方便将来增加协作者管理。`UserNotification` 对同一 `pageNoteId`、`recipientUserId`、`type` 建唯一约束，重试不会重复通知。

笔记创建、收件人校验、关系写入和通知写入必须在同一个 Prisma transaction 中完成。若客户端重复提交相同 `clientNoteId`，沿用当前幂等行为并返回现有笔记，不再次生成通知。

通知查询必须同时限制：收件人是当前用户、页面未删除、当前用户仍是该 Space 成员。这样成员被移除后不会继续看到原页面标题或笔记摘要。标记已读接口只接受当前用户自己的通知 id。

### 服务端接口

扩展页面笔记创建输入：

```json
{
  "clientNoteId": "…",
  "body": "…",
  "target": { "kind": "selection", "from": 0, "to": 3, "quote": "…", "prefix": "", "suffix": "", "baseUpdatedAt": "…" },
  "recipientUserIds": ["user-id-1", "user-id-2"]
}
```

`recipientUserIds` 可选，去重后最多 50 个。服务端只接受当前 Space 中的有效人类成员，过滤作者本人；提交不存在、已离开 Space 或 Agent id 时返回明确的 400，不静默通知错误对象。

新增受保护的通知接口：

- `GET /notifications?unreadOnly=&limit=`：返回最近通知、未读数，以及每条通知的 `pageId`、`pageNoteId`、`href`。
- `PATCH /notifications/:id/read`：把当前用户的一条通知标记为已读，幂等。
- `POST /notifications/read-all`：把当前用户当前可见通知全部标记为已读。

响应不返回密码、凭证或无权限页面内容；正文摘要限制长度，页面当前权限仍由 `/pages/:id` 再次校验。

### 页面交互

`SelectionNoteComposer` 在现有正文输入下方加入“协作人”选择区：输入 `@` 或点击选择框打开当前 Space 的人类成员候选，支持搜索、多选和可移除的 chip。正文和原文引用保持独立，选择协作人不会改变引用范围。阅读页和编辑页共用这一组件；客户端把选中的 user id 传给 `usePersonalNotes.add` 和页面笔记 API。

Navbar 增加消息铃铛和未读徽标，复用现有审核数量的轮询/可见性刷新模式。点击铃铛显示最近通知和“查看全部”；点击某条通知先标记已读，再跳转到：

`/pages/<pageId>?note=<pageNoteId>`

`PagePreview` 读取 `note` 查询参数，在页面和笔记数据就绪后调用已有的 `activateNote`/`openPanel('notes')`，并用已有的 `locateReadingNote` 定位原文；现有 Markdown hash 滚动保持不变。通知页 `/notifications` 提供分页/加载更多和未读筛选，复用同一通知 API，作为历史记录入口。

### 错误和并发处理

- 通知创建失败时整个笔记 transaction 回滚，客户端保留现有的“未保存”状态并可重试。
- 通知查询失败不影响页面阅读；Navbar 保留最后一次成功的徽标，登录失效时清零。
- 通知链接的页面已删除或权限已失效时，页面返回现有权限/不存在提示；通知仍可标记已读。
- 使用数据库唯一约束和 `clientNoteId` 幂等保护，避免网络重试造成重复笔记或重复通知。
- 只查询当前收件人最近一页通知，并为 `(recipientUserId, readAt, createdAt)`、`(pageNoteId, recipientUserId, type)` 建索引，避免全量扫描。

## 验证

服务端测试覆盖：收件人 Space 成员校验、作者过滤、重复提交幂等、同一 transaction 回滚、通知收件人隔离、已读幂等和成员移除后的过滤。客户端测试覆盖：多人选择与移除、`@` 搜索、笔记请求携带 recipient ids、Navbar 未读徽标/下拉、点击通知跳转 query，以及页面从 query 自动打开笔记并定位。发布前执行类型检查、相关单元测试、数据库 migration deploy/readback 和浏览器验收：两名成员分别创建笔记、收到通知、点击后准确定位；无权限成员不能读取通知或页面摘要。

## 未纳入本次范围

邮件、Web Push、短信、Agent 收件箱、通知偏好设置、通知撤回，以及对既有笔记的协作人编辑。后续若需要，由同一 `UserNotification` 模型扩展新的 `type`，不改变页面笔记的权限边界。
