# 当前人类 Space 的 MCP 隔离夹具调用序列（仅准备）

本文件只记录调用顺序，尚未创建文件夹、页面或 ChangeSet。执行由根代理在候选部署完成后控制；任何一步不是预期的自动发布都必须停止。

## 已确认的权限边界

- 当前 MCP 连接报告 `credentialScope=agent`，使用远程 live-agent grants，不伪造人类 JWT，也不读取 Chrome 密码或 `localStorage`。
- 原 Space 为 `项目管理`，`spaceId=cmtmgsk5b00neuo709n0x7nqj`，当前 MCP grant 角色为 editor；目录为 `AgentWik的 Bug 记录`，`folderId=cmv6buihz008rkoishl925mux`。当前人类用户仍由浏览器和服务端独立鉴权。
- 远端只读审计显示当前 Agent grant：`role=editor`，`folderScopes=[folders:read,folders:write]`，Agent active，`approvalMode=scoped-auto-publish`；Space `approvalPolicy=scoped-auto-publish`。`propose_folder_change(create)` 和 `propose_page` 应满足自动发布门禁。
- 当前 grant 没有 `folders:delete`。创建完成后由当前人类用户在浏览器中用正常 Folder 删除流程清理；Agent 不能调用人工审批或删除。
- 只读 `wiki_list_folders` 最近看到源目录树版本 `118`。执行时必须重新读取，不能复用这个旧版本。

## 不执行生产写入前的准备

源夹具的 9 个页面按原快照顺序复制，标题和完整正文逐字节保持：

`f31ccf05-70d0-4376-95c3-f507a5bb1bce`、`c90bcb40-1a3c-472a-a414-6a9f4298041a`、`aa1739e9-092e-4b61-a4a1-8c63d634817a`、`117ada12-8288-4055-b547-459db6dc4c54`、`c74b5272-7110-414c-a948-4bf03073d028`、`4088516b-4f90-4803-aeb2-7ddc63a86c32`、`4ca9b323-82c2-4077-b9f2-b025fff74d98`、`0459b4aa-47b3-4959-b092-20c9a9d8dbf8`、`3300a11b-0daf-4617-8e4c-ff008e069b85`。

先用 `wiki_get_page` 读取每页完整 `title/content/updatedAt`，只在私有临时内存中计算字符数、UTF-8 字节数和 SHA-256。正文不写入仓库，不在聊天消息中回显。

## 执行序列

下面的 `__args` 是 MCP 工具的完整参数包装；所有 ChangeSet 返回必须记录 `changeSetId/status/autoPublished`，不记录正文、token 或 provider 原始错误。

1. 重新调用 `wiki_list_spaces`，确认目标 Space 仍是上述 ID，角色仍为 editor。
2. 调用 `wiki_list_folders({spaceId})`，确认源目录仍存在，重取 `treeRevision`。
3. 创建唯一根夹具目录：

   ```text
   wiki_propose_folder_change({
     __args: {
       operation: "create",
       spaceId: "cmtmgsk5b00neuo709n0x7nqj",
       name: "AUTOTEST-<timestamp>-9-report",
       parentId: null,
       expectedTreeRevision: "<fresh treeRevision>"
     }
   })
   ```

   只接受 `autoPublished=true` 且 `status=published`。若为 `pending_review`、`rejected` 或返回的 `autoPublished` 缺失，立即停止，不调用页面创建；Agent 无权自行审批。

4. 对 9 个原页面逐个调用 `wiki_propose_page`，每次创建前重新 `wiki_list_folders` 取得最新树版本。参数保持原标题和完整 Markdown 正文；该 MCP 创建工具不接收 `format`，执行前应确认 9 页均为 Markdown，否则停止调整方案：

   ```text
   wiki_propose_page({
     __args: {
       spaceId: "cmtmgsk5b00neuo709n0x7nqj",
       title: "<source.title>",
       content: "<source.content>",
       folderId: "<fixtureRootFolderId>",
       expectedTreeRevision: "<fresh treeRevision>"
     }
   })
   ```

   每一步只接受 `autoPublished=true/status=published`。从返回的 `items[0].publishedResourceId` 保存新 Page ID；若返回没有已发布 Page ID，停止并通过只读 `wiki_list_pages`/`wiki_get_page`核对，不以标题猜 ID。新目录最终必须恰好包含这 9 个 Page，不能另建第 10 个目标页。

5. 对新目录内标题为 `Bug 状态汇总表` 的副本做只读核对：正文 hash 应等于原目标快照 `9e7decb...`，目录中总页面数为 9，9 篇正文总字符数仍为 137,879。若同名标题已存在且无法用新 Page ID 区分，停止并清理已确认的夹具 ChangeSet，不继续发送 Agent 请求。
6. 根代理用当前 Chrome 人类登录态打开这个新目标页，确认目录上下文展示 9 篇。通过面板发送原意图：

   ```text
   根据本目录所有测试报告，更新 bug 状态汇总表
   ```

   不手工注入历史，不修改原 9 页，不使用原生产会话。新 session 的自动 turn 必须以当前副本目标页为 `pageId`，目录应为这个夹具目录。

7. 在浏览器中轮询该新 session，直到明确 `done` 或安全失败。`queued/running`、HTTP 成功、模型返回 success 都不是保存完成证据。成功要求回执 `operation=updated`、`document.pageId` 等于该副本目标 Page，刷新后正文与回执版本一致；失败要求 UI 显示安全失败码/提示且没有目标页写入。
8. 通过当前人类浏览器刷新副本目标页，再用只读 MCP `wiki_get_page` 读回目标和其余 8 篇副本，核对：目标正文有完整表格/来源/状态边界；9 个副本 Page ID、标题、正文 hash 与创建时记录一致（目标除外）；原目录的 9 个 Page ID、版本和 hash 仍完全不变。
9. 根代理确认 session 已终态并保存回执后，在浏览器对根夹具目录执行正常 Folder 删除，读取删除影响范围后以最新树版本提交。删除对象必须严格匹配该根目录及其 9 个子页；不删除源目录或 Space。删除失败时保留夹具等待人工处理，不盲目重试。
10. 删除后重新读取原目录 9 页和 `wiki_list_folders`，确认原 hash 不变、夹具目录不存在。删除回执的批次 ID 和时间作为证据保留。Session 没有删除接口，完成的测试 session 仅作审计记录；不把它挂到原生产页或原生产会话。

## 停止条件

- 任一 ChangeSet 没有 `autoPublished=true/status=published`；
- 树版本冲突、页面 ID/目录数量不符合预期、正文 hash 不一致；
- Agent 选择 create 而不是 update，或回执页 ID不是副本目标；
- turn 超时但仍 queued/running；先在 UI 取消并确认终态，不能删除夹具；
- 原目录任何页面 title、updatedAt 或正文 hash 改变；立即停止后续操作并保留证据。
