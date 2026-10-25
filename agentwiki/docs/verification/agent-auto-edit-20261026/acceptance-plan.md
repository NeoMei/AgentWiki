# 真实 9 文档自动更新验收（准备方案，尚未执行）

本方案只准备 API 操作与断言，未向生产发送创建、提交、取消、删除请求。由根代理决定并执行生产步骤。离线脚本没有网络、数据库客户端，也没有 `--execute` 模式：

```sh
node scripts/agent-auto-edit-real-space-acceptance.mjs \
  --space-id '<当前用户原 Space ID>' \
  --source-folder-id '<原 9 报告目录 ID>'
```

可额外传入 `--sources /absolute/path/pages.json`，内容为通过只读接口取得的 9 个 `{id,title,content,updatedAt}` 对象。脚本只输出 ID、版本、字符/字节数、SHA-256，不输出报告正文或标题。该文件应保留在本地私密临时位置，不能提交到仓库。

## 为什么原有验收不足

`scripts/assist-routing-e2e.mjs` 创建新用户和新 Space，使用单页短正文，走旧 `/assist/tasks` 路径，验证生成结果后清理整 Space。它没有验证新 `/assist/sessions/:id/turns` 的 `auto` 判定、真实目录 MCP、长 history、worker 原子写入与 UI 重新读取。

`assist-session.service.spec.ts`、`assist.queue.spec.ts`、`assist-document-writer.spec.ts` 验证权限、任务状态、解析与写入边界，但依赖内存/Mock，不能替代生产队列、真实模型与数据库保存验收。

先前 9 文档合成用例的每篇报告很短，且没有旧历史。真实只读重建得到 9 篇合计约 137,879 字符/249,099 字节，历史约 115,789 字符，更新提示约 129,483 字符；真实失败轮在约 302 秒耗尽预算。这些是不同负载，不能互相代替。

## 首选：同 Space 内独立目录、9 报告副本、独立目标与会话

1. 以当前人类用户身份读取原目录完整树，分页和递归不可遗漏，确认恰好 9 篇。GET 每页完整正文，保存仅本地的原始快照和 SHA-256。读取实际汇总表，保留其完整字段、逐项回复和回归信息作为测试目标初始正文。
2. 在同一 Space 根下创建唯一 `AUTOTEST-<run-id>` 文件夹。其下建立 `sources` 子目录，原样复制 9 篇正文到其中；汇总目标放在 `AUTOTEST` 根下。这样目录 MCP 仍恰好读取 9 篇，不把目标意外作为第 10 篇来源。每次结构写入前重取 `content-tree.treeRevision`，碰到 409 不盲目重放。
3. 创建新 AssistSession。以 `pageId=测试目标`、`directory.folderId=sources副本目录`、`mode=auto` 提交完整更新意图与目标最新快照。请求 ID 使用一次生成的 UUID；不确定提交结果时先读 session，以同一 UUID 重试，不能新建 UUID 制造重复任务。
4. 轮询当前 turn，直到 `done/failed/cancelled`。HTTP 201 或 `queued` 不算完成。记录提交时间、终态时间、安全失败码、进度、最终 action 与 document receipt。
5. 必须同时满足 `done`、`action=update`、`document.operation=updated`、`document.pageId=测试目标`。独立 GET 目标页，要求版本与 receipt 一致、完整正文与 `result.changes` 一致。人工/结构检查来源覆盖、原字段保留、逐项状态和回归信息；只看字数或“更新完成”文字不算语义验收。
6. 浏览器打开测试目标，刷新后检查保存后的表格与会话回执。该步验证前端读取与显示，不由 API 完成替代。
7. 重读 9 篇原报告，要求 title、updatedAt、完整正文哈希完全不变。清理只使用正常 Folder API，见下文。

副本的正文可完全一致，但 pageId、updatedAt、路径和文件链接目标会变化。因此应记录“相同正文负载”，不能声称是生产原文身份/历史的完全复现。若原目录有重名或嵌套目录，保持原子目录结构，不把所有同名页扁平化。

## 较低扰动：新测试目标 + 原目录来源

脚本 `--mode live-sources` 生成此方案：仅新建测试目录、目标和会话，`directory` 指向原 9 报告目录。它保留真实来源 ID、版本、链接与正文，减少复制。

此 API 没有允许调用方指定 `action=update` 的参数。服务同时允许 update 与 create；模型如错判 create，可能在原目录新建一页。因此它不是对原目录绝对只读的方案。执行前应确认该风险可接受，执行后核对完整目录增量；若出现 create，立即判失败，保存回执并仅清理回执指向的已确认测试页。不得根据标题批量删除页面。首选副本方案能把这种误判限制在测试目录中。

## 长 history 如何覆盖

正常 API 没有 history import/clone 路由；只能逐轮发送并由模型产生新结果，无法准确恢复旧 `failed` 状态、answer/changes、历史版本和时间。新的 10 轮聊天不等于原来 115k history，单纯重复“OK”更不能证明长 history 修复有效。

精确旧历史用只读 `executionContext` 重建与 runner probe，或在隔离数据库中构造完整旧会话快照。保留每轮身份、不同正文版本、answer、changes 与失败状态。验证去重后可无损恢复，确认 source 字符/字节数与最终提示长度。将这份证据和真实队列保存验收并列记录，不能合并称为同一生产 E2E。

如果必须在生产原会话继续一次，历史可原样保留，但绑定测试页后不得删除该页：`authorizedTurns` 要求所有历史来源仍存在，删掉任一历史测试来源会导致整个原会话被屏蔽。此方案会留下测试内容，也改变原会话历史，不作为默认回滚方案。

## 清理与恢复

- 若 turn 仍 queued/running，先 `POST /assist/tasks/:id/cancel`，再读取终态；若已经 done 则先保存回执。仅请求取消而未确认终态时不能删源或目标。
- 在清理前导出安全验收记录，列出每一个创建的 folder/page ID；不要记录 token、provider 原始错误或报告全文。
- 读取测试根目录完整树，确认每个对象都在 fixture 清单中。`GET /spaces/:spaceId/folders/:folderId/delete-impact` 返回 `rootUpdatedAt/treeRevision/impactHash`。以这三个最新值调用 DELETE 同一文件夹，正常递归软删除测试页与子目录。冲突时重新核对影响范围，不盲目更新版本后重试。
- 保存删除回执的 `deletionBatchId` 与版本。恢复时走 `POST /spaces/:spaceId/folders/:folderId/restore`，按接口要求传删除批次、最新版本与 `mode=original`。不要直接改数据库。
- 确认测试根目录不再出现在 content-tree，原 9 篇内容哈希和版本仍不变。不得删除用户 Space、用户帐号或原报告。
- 现有 API 无 DELETE session。session 数据库记录会保留；其测试来源被删后 session 会因来源不存在而不可访问。只有独立测试会话可以接受此结果，不能把测试 fixture 挂到原生产会话后再删除。

## 通过标准与证据边界

保存：源 count/bytes/chars/hash、提示/history 指标、运行时间、task/session ID、终态、action、document receipt、回读正文 hash、浏览器刷新截图、清理回执。文档质量应覆盖原表字段与回归项，保留报告来源链接。

单元测试、只读真实 runner、生产队列保存、浏览器刷新、清理回读分别列结果。只有 runner 通过不能宣称队列保存通过，只有短合成通过不能宣称原 9 报告和长历史通过。
