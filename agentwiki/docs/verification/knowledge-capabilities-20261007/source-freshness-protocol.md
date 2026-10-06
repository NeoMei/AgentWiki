# 来源复核真实验收协议

本入口准备独立真实 API、ingestion Worker、已构建前端和两份持久 MCP reader，直到 **v1 两页候选待人工审阅**。它不自动接受、批准或发布候选，不执行模型，不把准备成功当成产品验收通过。

截至本文件交付，仅做纯单元/协议/安全测试与语法验证。真实启动必须等待固定 Task1/Task2、SQL migration 和构建通过独立审查；本文件没有生产运行或部署回执。

## 固定边界

- `scripts/source-freshness-fixtures.mjs` 是操作者合成 OKF 输入；两页事实从 v1→v2→v3 改变。消费者不得读这个模块、state、operator结果或其他消费者答案。OKF 的生产 pipeline 本身是确定性编译，不需模型 provider，也未替换 SourceService/worker。模型只用于后续真实知识读取。
- 正式页面、Evidence、Run、ChangeSet、Approval 必须经 confirmed OKF HTTP→真实worker→人工 UI 审阅发布产生。此 harness 不调用 Prisma seed。导入现有 retrieval harness 只复用已导出的资源管理函数，不调用它的 serve/seedCorpus。
- 只有随机 `collaboration_test_*` schema、自有 Redis/端口/PID、临时 home/上传目录和单独浏览器会话；严禁共享 Redis、全局清理、其他会话 runtime 和生产数据库。保护库存/migration corpus 继续由原 helper 验证，不能调高或绕过门禁。
- 固定提交及源码/构建/技能在整个阶段不变。`--expected-commit` 要求准确40位 HEAD，产品源码不能有未提交修改；构建哈希另记，操作者仍须独立确认 build 来自该候选。harness 不构建产品。
- 每份输入都以完整 fixture SHA-256 单独确认，包含sourceKey/producer/正文等全部字段。v1确认不授权任意后续文件；upload 仅允许生成的 v1/v2/v3，A→B→A再次用v1完整输入及新的幂等键。

## 操作者启动

在 `agentwiki/` 目录先查看无副作用计划与fixture：

```sh
node scripts/source-freshness-acceptance.mjs plan
node scripts/source-freshness-acceptance.mjs fixture v1
```

`fixture` 输出 `{confirmation,envelope}`，只给操作者阅读。先检查两页摘要与hash，再启动。安全注入以下环境变量，不打印URL或凭据：

- `SOURCE_FRESHNESS_TEST_DATABASE_URL`：已批准的专用 loopback test PostgreSQL，沿用原 migration/inventory helper。
- `PG_DUMP_BIN`：兼容服务端版本的绝对 pg_dump 可执行路径。
- `SOURCE_FRESHNESS_STATE_FILE`：现有、当前用户拥有、0700证据父目录下尚不存在的绝对`.json`路径。

```sh
node scripts/source-freshness-acceptance.mjs serve \
  --confirm-fixture=<本次v1完整fixture的confirmation> \
  --expected-commit=<独立审查通过的40位候选SHA>
```

不要在 Task1/2 工作树仍有产品修改时启动。Redis为单独进程，启用AOF/everysec。API与Worker的cwd是临时根，只继承基础环境白名单，不读仓库.env，不继承provider/proxy凭据。API与Worker共用本次随机schema/Redis和生成密钥；Worker并发1。前端用 Vite **preview** 及本次临时纯配置服务冻结`apps/client/dist`，envDir是临时根，`/api`和`/socket.io`只代理此次API。

启动经真实API创建临时owner、Space、独立reader a/b与一篇无来源的手工页面；上传已确认v1，等待worker完成且ChangeSet恰有两项pending create_page。准备失败会有界退出；每HTTP请求15秒、startup45秒、Run候选90秒。准备好后最多等待两小时，任何自有API/Worker/Web/Redis进程意外退出也结束本次运行，保存诊断。

`READY`只给state/evidence路径、API/Web origin、Space、待审ChangeSet与consumerPath。0600 state含临时owner登录账号/密码/token、reader凭据和session元数据，仅操作者可用。不要cat到模型提示或公共日志。浏览器在此次webOrigin `/?intent=workspace#login` 使用私有state里的临时owner真实登录；不用用户日常会话。审核页面为 `/review?changeSet=<READY的ID>`。

## 人工UI主线

1. v1：展开待审两项，逐项接受，再点“通过并发布”。这是实际 UI 操作，记录截图/请求结果。Run completed只是编译完成。页面ID由实际发布项的publishedResourceId或读回列表取得，不猜测。
2. 确认并上传v2，正式两页正文仍v1，sourceStatus应needs_review；独立手工页仍untracked。分别核对REST单页/list/search/hierarchy、MCP单页/list/search/page resource、graph节点。worker已生成候选也不能让正式页自动current。
3. 新真实消费者A回答下方三问；不要给fixture答案、期望状态标签或其他模型答案。
4. v2 UI只接受分派页、拒绝保留页，然后通过并发布。只有接受页是新结论/current，拒绝页继续旧结论/needs_review。核对旧依据仍可追溯并标历史。
5. `new-run`接口为同一Source的当前head建立**新Run**，重新生成被拒绝项；不用retry一个completed Run。UI接受并发布剩余候选。新真实消费者B再回答三问，核对新结论与旧历史依据。

## 有界操作者命令

命令只面向本次 Space，单资源操作先通过API核对spaceId；revoke-reader仅使用state登记的a/b凭据。输入正文由操作者明确给出。CLI不接受approve、publish、review-publish或item decision动作，不能用它替代UI验收。

```text
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> read '{"kind":"page-list"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> read '{"kind":"pages","id":"<pageId>"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> read '{"kind":"sources","id":"<sourceId>"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> read '{"kind":"runs","id":"<runId>"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> read '{"kind":"change-sets","id":"<changeSetId>"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> read '{"kind":"versions","id":"<pageId>"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> read '{"kind":"graph"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> read '{"kind":"hierarchy"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> read '{"kind":"search","query":"分派"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> read '{"kind":"review-list"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> read '{"kind":"tree"}'
```

后续上传先运行 `fixture v2` 或 `fixture v3` 查看相应confirmation。独立边界序列用 `fixture v1 freshness-aba` 等不同sourceKey，hash也随之不同；上传前单独确认。

```text
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> upload '{"version":"v2","sourceKey":"freshness-main","idempotencyKey":"main-v2","confirmation":"<v2哈希>"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> new-run '{"sourceId":"<sourceId>","idempotencyKey":"main-regenerate-v2"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> manual-edit '{"pageId":"<pageId>","content":"<明确的新正文>"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> restore '{"pageId":"<pageId>","versionId":"<真实PageVersionId>"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> revert '{"changeSetId":"<已发布ChangeSetId>"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> archive '{"sourceId":"<sourceId>"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> activate '{"sourceId":"<sourceId>"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> cancel '{"runId":"<runId>"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> retry '{"runId":"<runId>"}'
node scripts/source-freshness-acceptance.mjs operator --state=<绝对state> revoke-reader '{"agent":"a"}'
```

`manual-edit`读取最新updatedAt作为乐观基线；restore/revert读取最新treeRevision，再发生产接口。若要故意测试过期基线冲突，由操作者按实际接口另发固定旧值，不以CLI的自动取当前基线冒充race。`read`一次读取，不暗中轮询/重试；等待Run时以1秒以上有界节奏读取，不修改限流。

接口对照（均在本次`/api`下）：

| 操作 | 实际接口/请求 |
| --- | --- |
| confirmed upload | POST `/spaces/:id/knowledge-syncs`；multipart file=`*.okf.json`；idempotency-key及x-agentwiki-user-confirmed=true |
| 当前sync身份 | GET `/spaces/:id/knowledge-syncs/:sourceKey`；只返回path/hash，不是全文 |
| 新Run | POST `/sources/:id/runs` + idempotency-key |
| item决定/UI | PATCH `/change-sets/:id/items/:itemId`，`{status:accepted或rejected}` |
| UI通过并发布 | POST `/change-sets/:id/review-publish`，`{comment}` |
| UI分离批准/发布 | POST `/change-sets/:id/approve`，随后 `/publish` |
| 恢复PageVersion | POST `/pages/:id/versions/:versionId/restore`，`{expectedTreeRevision}` |
| 精确ChangeSet回滚 | POST `/change-sets/:id/revert`，`{expectedTreeRevision}` |
| 来源归档/恢复 | DELETE `/sources/:id` / PATCH 同路径 `{status:active}` |
| 取消/重试 | POST `/runs/:id/cancel` / `/retry` |
| 读者撤权 | DELETE `/agents/:id/credentials/:credentialId` |

缺少上传确认的负例需操作者另以同一生产接口发送一个独立sourceKey的multipart、**不带**confirmed header，检查SYNC_CONFIRMATION_REQUIRED且无head/Run产生。CLI在发送前拒绝错hash只是封装安全测试，不能当成这个实际API负例通过。

## 后续边界顺序

- 部分发布后新建Run：正确固定当前head，接受页不重复变更、拒绝页仍生成候选。
- supersede：独立sourceKey A发布→B待审并通过但不发布→上传C→UI发布B必须SOURCE_VERSION_CONFLICT且整笔无发布副作用。保留真实已存在Approval，不错误要求审批总数为零。
- A→B→A：独立sourceKey A1发布→B2→再次完全相同A/K3；版本ID可复用而代次增加，A1页面仍needs_review，旧A/B候选不得发布，A3新候选人工发布才current。
- 幂等：A/K1→A/K2→B/K3→重放A/K2，head不得倒退、不得重新queued；同key异内容必须冲突。每步对应fixture hash明确确认。
- 人工编辑实际变更清代次；同值、标题/位置变化按规则保留。PageVersion恢复实际正文变化清代次；ChangeSet精确revert恢复before代次且不修改Source head，二者分开验收。
- archive时不可current但有权历史依据保留，阻止新worker/publication；activate恢复比较，不增代次。撤销reader a后用原持久gateway再次读，不能返来源；独立b仍正常。
- 迟到worker的受控测试需要先停止本次Worker再排B/C并重启；当前serve的liveness guard会在Worker退出时结束整个runtime，故**不能在该serve中直接kill Worker再假装继续**。精确worker race先由Task1数据库并发测试证明；若Task3确需该人工控制场景，另用审查过的专用运行安排，不修改DB状态或关闭liveness来伪造。
- 历史null/corrupt跨Space FK只能在单独安全夹具seed，并明确标为损坏/历史测试。主线不得seed Source、Version、Run、Evidence、Page、Approval。当前harness未提供任意SQL入口。

## 模型与UI验收

root另行启动真实模型消费者，不把执行模型写进harness。state兼容version2 `loadConsumerState`；每份reader有home/wrapperPath/ipcRoot/socketPath/sessionId，state有harnessPid/resourceRoot/apiUrl/consumerPath。消费者仅调用：

```text
node <consumerPath> --state=<absoluteStatePath> --agent=a tools
node <consumerPath> --state=<absoluteStatePath> --agent=a call <实际只读tool> '<自行填写的JSON>'
```

A在v2未审时，B在补齐发布后，分别问相同中立三问：①当前分派复核窗口与记录保留期限？②这些结论是否已复核且与当前已接收来源一致，资料不足/过时时说明依据与限制？③提供可获取的页面、来源版本/历史依据，区分正式知识与待审来源。具体答案只属于operator材料。记录实际模型/effort、原答案、读取trace；Agent不能执行operator命令或读本协议的fixture资料。

UI在1280、1600、390实际viewport检查 `/pages/:id`提示与页面信息、长文/宽表/TOC、`/review?changeSet=id`部分选择和失败反馈、`/pages/:id/edit`、`/pages/:id/versions`、`/spaces/:id/sources`、`/spaces/:id/runs`、`/spaces/:id/graph`。截图避开凭据，记录commit与viewport，不能以HTTP回包替代真实UI观察。

sourceStatus版本字段按实际类型引用：reviewedSourceVersionId/currentSourceVersionId、reviewedSourceVersion/currentSourceVersion、reviewedSourceGeneration/currentSourceGeneration；不把SourceId写成版本ID，不以current声称事实绝对正确。最后另跑固定检索8题两场integrated candidate，保持既有语料、baseline/原失败分数不变；生命周期三问与固定8题分开编号和评分。

## 证据与退出

`run.json`记录提交、source/build/harness哈希、migration/public inventory、fixture hash、资源PID与v1候选ID，不包含登录凭据；`http.jsonl`/`operator-http.jsonl`只存脱敏路径、状态、业务码、耗时、响应hash/字节，不存headers/request bodies。`operator-results.jsonl`保存经过封装脱敏的操作者读回；因此**封装结果不能用来证明原始公共API没有泄漏**，Task2服务端原始DTO的授权白名单仍须独立检查。模型facade结果同样需结合真实原始协议测试。保留v1/v2/v3合成输入供操作者追溯。

SIGTERM/SIGINT本次harness PID退出；先移除自己的state，关闭reader，再停止Worker/Web/API，原wrapper清schema并核对库存，最后停Redis并删除自有临时workspace。成功或失败都保存脱敏`process-diagnostics.json`和consumer trace。日志为有限滚动输出，不能声称保存了全部历史。任何关闭未核验则保留workspace，返回STOPPED_WITH_UNVERIFIED_CLEANUP；只有CLEANED且databaseCleaned/protectedInventoryVerified/resourcesRemoved为true才能声明清理通过。操作者额外核对端口关闭；此脚本不通过“抢占端口”来清理其他进程。

真实模型结果、UI截图和逐阶段before/after业务断言由操作者追加到本次证据目录。READY/CLEANED分别只证明准备/清理，不能证明主线或所有边界验收通过。无push、merge、生产迁移、发布或部署。
