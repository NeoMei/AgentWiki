# 组合式页面组模板与 Agent 协作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 当前采用本会话顺序执行；只有用户明确要求后才切换到 subagent-driven-development。

**Goal:** 从统一模板创建真实多层页面组，并允许新旧页面通过长期 Agent 绑定、显式任务和一次人工审核进入协作。

**Architecture:** 组合 TemplateVersion 持有结构与协作定义。内容树负责一次性结构写入，协作引擎负责运行和租约，ChangeSet 负责发布；应用服务通过同一数据库事务连接三者。

**Tech Stack:** TypeScript、NestJS、Prisma 5.22/PostgreSQL、React 18、Tailwind、Zod、Jest、Vitest、Playwright；沿用 pnpm 11.9.0 与仓库 Node 24/26 范围。

**Spec:** `docs/superpowers/specs/2026-09-05-composite-page-group-agent-collaboration-templates-design.md`（2026-09-05 用户已确认，设计提交 d5538e5）。

## Global Constraints

- 一个不可变组合 TemplateVersion 是页面结构与协作定义的事实源；历史版本不可重写。
- Folder 只表达层级、名称和顺序，不能持有 Agent 或任务。
- 未绑定是正常状态，历史页面不强制回填。
- 绑定不创建、不升级、不恢复 AgentGrant。
- 本次参与 Agent 只来自启用任务的负责人；活动运行冻结责任分配。
- 页面目标任务强制人类审核，publisher 不能在该路径自动发布。
- 实例化全有或全无；一次内容树 revision；外围通知在提交后执行并可重试。
- 不复制附件，不重写 Markdown 图片引用，不修改 Sync v3 manifest 或协议。
- 所有新增文案支持简体中文和英文，复用 ModalDialog 与现有组件。
- PostgreSQL 测试只使用专用数据库与随机 schema，禁止迁移或清理 shared public。
- GitHub push、npm 发布与生产部署继续需要独立授权。

---

## 执行顺序与阶段交付

这是一条有强依赖的功能链，采用一个主计划、四个可独立验收的阶段；阶段内不为每个小步骤重复请求批准。

| 阶段 | 任务 | 可验收结果 |
|---|---|---|
| I 模板基础 | 1–4 | 旧目录可用，新组合定义、迁移及模板 seed 可预览 |
| II 页面组与绑定 | 5–7 | 原子创建页面树；历史页面绑定和可复用目录模板 |
| III 运行与发布 | 8–10 | 页面任务运行、提交、单次审核、冲突恢复 |
| IV 产品闭环 | 11–13 | 新旧入口、灰度与真实浏览器/Agent 验收 |

所有路径以 `agentwiki/` 为相对根。下文标为“新建”的文件是计划交付物；修改文件已在当前工作树核对存在。实现前应重读最新 master 的相同落点。

## 实施前的代码证据与修订约定

1. `ContentTreeService.createFolder` 即使接受外部 transaction 也逐次推进 revision；不能循环调用它实现页面组。任务 5 抽出无 revision 的内部创建原语，再整体推进一次。
2. `CollaborationRun.templateId` 当前是旧 CollaborationTemplate 的非空外键；任务 2 引入互斥来源，绝不新建伪旧模板以满足外键。
3. `reviewPublish` 先提交批准，再调用另起事务的 `publish`；任务 9 提取事务内发布能力。直接串行调用两种审核 API 不能证明原子性。
4. 设计 9.1 的 RunTask 基线与“基于最新版本重新生成”同时成立的实现：RunTask 保存初始基线，每个 Attempt 保存自己的权威基线；领取时冻结，重试续租不能偷偷变更，内容修订新 Attempt 可取新基线。
5. 修复请求内容后必须换幂等键；网络重试保持原键和原请求。设计中的“修复后重试同一请求”只适用于字节语义不变的网络重试。
6. 回滚指关闭入口开关，同时保留新服务版本继续处理已存在 Run。不能用不认识新来源字段的旧二进制接管新运行。
7. 同一角色槽下多个页面若绑定不同 Agent，预览返回冲突并要求本次显式映射；不随机取第一个。单页简单流程生成每页独立槽，重复 Agent 在参与者列表去重。
8. 冻结运行指初始快照不可随模板和页面绑定变化；保留原有人工改派、撤权、驳回代际机制。
9. “Agent 已连接”使用既有凭据/准备状态，不新增必须先加入尚未创建 Run 的条件，也不引入实时在线探测。
10. 共享代码包名含 sync-protocol 不代表新增组合模板契约修改了 Sync v3；本计划只增独立模块和导出，不修改同步 wire schema。

## Task 1: 建立隔离实施基线与回归清单

**Files:** 新建 `docs/verification/composite-template-implementation-baseline.md`；读取设计、项目规则与 `package.json`。

**Interfaces:** 输入设计提交与最新 origin/master；输出带明确实际路径的实施分支、基线 SHA、验证命令和受保护文件清单。

- [ ] 记录当前 Git 配置；所有命令显式传入当前 worktree，验证输出等于实际路径。不要修改共享 core.worktree。

```sh
git --work-tree='/Users/neomei/.codex/worktrees/69d8/AgentWiki ' rev-parse --show-toplevel
git --work-tree='/Users/neomei/.codex/worktrees/69d8/AgentWiki ' status --short
git worktree list --porcelain
git config --show-origin --get core.worktree
```

- [ ] 获得实施授权后，fetch origin，按 using-git-worktrees 技能从最新 origin/master 创建 `codex/composite-page-group-agent-collaboration` 独立 worktree；将本设计和计划单独纳入该分支。只操作精确 worktree，保留其他任务改动。
- [ ] 对比 referenced-image-sync-v3、technical-debt-integration 分支与最新 master；记录已整合内容。此处只读，不合并其他任务未批准的工作。
- [ ] 运行基础检查并记录各命令退出码：

```sh
pnpm typecheck
pnpm --filter @agentwiki/server test --runTestsByPath src/page-templates/page-template.service.spec.ts src/collaboration-workflows/run.service.spec.ts
pnpm --filter @agentwiki/client test src/features/page-templates/NewPageDialog.spec.tsx
```

- [ ] 单独提交基线文档。尚未运行的数据库或真实 UI 检查记为未验证，不继承旧报告的 PASS。

## Task 2: 组合定义与可升级持久化来源

**Files:** 新建 `packages/sync-protocol/src/composite-template.ts`、`.spec.ts`；修改同目录 `index.ts`；修改 `apps/server/prisma/schema.prisma`；新建 `apps/server/prisma/migrations/20260905120000_composite_templates/migration.sql` 与 `scripts/composite-template-schema-db.test.mjs`。

**Interfaces:** 导出 `CompositeTemplateDefinitionSchema`、`CompositeTemplateDefinition`、`TemplateNode`；definition 固定 `schemaVersion:1`、`kind`、`nodes`、`collaboration`（null 或 `{workflow,taskTargets}`）。workflow 使用已有 CollaborationTemplateDefinition；taskTargets 是 `{taskNodeId,pageNodeId}[]`。

- [ ] 写以下失败契约测试，补齐 Zod union；Markdown 限制按 UTF-8 字节计数。

```ts
const single = {schemaVersion:1, kind:'single_page', nodes:[{
  nodeId:'page', parentNodeId:null, kind:'page', order:0,
  titleI18n:{'zh-CN':'纪要'}, contentI18n:{'zh-CN':'# 纪要'}, roleSlotKey:null,
}], collaboration:null};
expect(CompositeTemplateDefinitionSchema.safeParse(single).success).toBe(true);
expect(CompositeTemplateDefinitionSchema.safeParse({...single, agentId:'secret'}).success).toBe(false);
```

- [ ] 运行 `pnpm --filter @neomei/agentwiki-sync-protocol test src/composite-template.spec.ts` 观察失败，再实现 schema：Folder 字段为 nodeId/parentNodeId/kind/order/nameI18n；Page 字段如测试；严格拒绝未知字段。上限深度 8、100 节点、50 页、全部文本 5 MiB；叠加当前单页正文和协作节点上限。
- [ ] 为 PageTemplateVersion 增加 nullable definition/schemaVersion/definitionHash；不更新原 contentI18n。新版本以 definition 为权威，旧版本使用任务 3 适配器。
- [ ] Run 增加 sourceKind（legacy/composite/page_selection）、可空 compositeTemplateVersionId、templateInstantiationId；旧 templateId 改可空但旧值保持。SQL CHECK：legacy 必须有旧模板且无新来源；composite 必须有组合版本；page_selection 两模板来源均空但必须有冻结 templateSnapshot。
- [ ] 新建 TemplateInstantiation（Space+user+key 唯一、requestHash、结果 JSON）、TemplateInstantiationNode（实例+node 唯一、Folder/Page XOR）、PageAgentBinding（pageId 唯一）、PageAgentBindingEvent、CollaborationArtifactChangeSetLink（artifactId 与 changeSetId 分别唯一）、TemplateEffectJob（实例+效果键唯一）。关联含 Space 约束；运行页面目标、Attempt 基线字段可空，旧运行无回填。
- [ ] DB 测试使用已有 `withPageTemplateTestDatabase`：先迁移旧 schema/seed 旧 Run，再迁移新增 SQL，证明旧来源未变、新 Run 无旧 templateId 也可插入；对非法 XOR、重复映射和跨 Space 外键插入断言 reject。未设置 PAGE_TEMPLATE_TEST_DATABASE_URL 必须 fail，不能 skip。
- [ ] 运行 `pnpm --filter @agentwiki/server exec prisma validate`、schema DB 测试和协议 typecheck，通过后精确提交 schema、迁移及测试。

## Task 3: 统一目录与纯函数结构校验

**Files:** 新建 `apps/server/src/page-templates/composite-template-validator.ts`、`composite-template-validator.spec.ts`、`composite-template-catalog.service.ts`、`composite-template-catalog.service.spec.ts`；修改 `page-template.module.ts`。

**Interfaces:** `normalizeLegacyVersion(contentI18n): CompositeTemplateDefinition`；`validateCompositeDefinition(def): {code:string,nodeId?:string}[]`；Catalog 的 `resolve(tx,spaceId,templateId,version,locale)` 返回 `{definition,definitionHash,locale}`。

- [ ] 测试单页包装只生成一个固定 page 节点，旧版本对象保持不变；系统双语与 Space 来源语言回退沿用现有策略。
- [ ] 测试树环、两个根 Folder、Page 当父节点、重复 order 的确定性排序、悬空 taskTargets、多写者与缺失人工 gate。使用任务 2 single fixture，逐一修改单个字段以证明失败原因。

```ts
expect(validateCompositeDefinition({...single,nodes:[single.nodes[0],single.nodes[0]]}))
  .toContainEqual({code:'TEMPLATE_NODE_DUPLICATE',nodeId:'page'});
```

- [ ] 运行 `pnpm --filter @agentwiki/server test --runTestsByPath src/page-templates/composite-template-validator.spec.ts`，实现 map 查重 + DFS 颜色标记验环；复用既有 collaboration validator 检查 DAG、Todo、审核返回路径、required artifacts。
- [ ] 对被裁剪任务进行完整 DAG 复验，拒绝移除必需上游、必需终点或人工审核；不自动跳过依赖。纯研究任务允许无 page target。
- [ ] Catalog 聚合旧单页和新组合版本，支持 kind/scope/category/支持协作筛选、归档管理、分页。继承 100 个有效 Space 模板、标准化名称唯一和 Owner/Admin 管理限制。
- [ ] Catalog service 测试跨 Space、归档、旧历史版本读取、新写入单一权威 definition；运行两份测试并提交。

## Task 4: 六套系统页面组与旧模板显式升级

**Files:** 新建 `apps/server/src/page-templates/composite-template-definitions.ts`、`composite-template-definitions.spec.ts`、`legacy-workflow-upgrade.service.ts`、`legacy-workflow-upgrade.service.spec.ts`；修改 `page-template.service.ts` 的启动 seed 编排；读取 `collaboration-workflows/template-definitions.ts`。

**Interfaces:** `BUILT_IN_COMPOSITE_TEMPLATES`（stableKey/seedVersion/definition）；`LegacyWorkflowUpgradeService.preview/upgrade(spaceId,legacyId,input,principal)` 生成独立组合版本并保存来源链接。

- [ ] 测试六套模板均同时有中文英文、真实根 Folder、可达必需终点；五套旧系统协作定义都有对应 taskTargets，正文输出任务强制审核。

```ts
expect(BUILT_IN_COMPOSITE_TEMPLATES.map(t=>t.stableKey)).toEqual([
 'project-workspace','coding-workspace','bid-workspace',
 'paper-workspace','video-script-workspace','novel-workspace']);
for (const seed of BUILT_IN_COMPOSITE_TEMPLATES)
  expect(validateCompositeDefinition(seed.definition)).toEqual([]);
```

- [ ] 为项目管理创建概况、计划/里程碑和任务清单、治理/风险和决策、进展/进展记录和复盘；其余五套按设计第 5 节保留原有角色、任务、Todo 和依赖，增加页面输出映射。外部文件结果保留 artifact-only。
- [ ] seed 只在 seedVersion 增长时插入；重复启动无新版本。旧项目管理单页仅在统一新建目录隐藏，保留旧 API 和来源读取。
- [ ] 自定义旧流程升级要求 Owner/Admin 明确提供页面结构和 taskTargets；使用旧 version + definitionHash 做 CAS，不推断目录。重复 upgrade 幂等、名称冲突返回明确错误、旧模板继续只读可启动。
- [ ] 运行新 seed/upgrade 测试及 `src/collaboration-workflows/built-in-templates.spec.ts`，通过后提交。若旧自定义模板含多个必要人工 gate，升级预检返回显式问题，保留旧流程可用；用户解决映射前不自动删 gate。

## Task 5: 一次 revision 的原子页面组创建

**Files:** 修改 `apps/server/src/content-tree/content-tree.service.ts`、`.spec.ts`；新建 `apps/server/src/page-templates/template-instantiation.service.ts`、`.spec.ts`；新建 `scripts/composite-template-instantiation-db.test.mjs`。

**Interfaces:** `ContentTreeService.createFolderLocked(tx,input)` 返回 Folder，仅用于已持有 Space 树锁事务，不推进 revision；现有 createFolder 包装该原语保持原行为。`TemplateInstantiationService.instantiate(spaceId,templateId,input,principal)` 返回 `{instantiationId,rootFolderId,pageIds,runId,treeRevision}`。

- [ ] 写 DB 故障测试：第 3 页插入失败后 Folder/Page/实例/映射/绑定/Run 数量与 revision 均等于操作前；只看 mock 调用不算事务证据。
- [ ] 实现测试先创建 2 级目录+3 页，并断言一次 tree revision：

```js
const before = await prisma.space.findUniqueOrThrow({where:{id:spaceId}});
const result = await instantiateFixture({failAt:null});
const after = await prisma.space.findUniqueOrThrow({where:{id:spaceId}});
assert.equal(after.contentTreeRevision, before.contentTreeRevision + 1n);
assert.equal(result.pageIds.length, 3);
```

`instantiateFixture` 在该 DB 测试文件中建立用户、Space、fixture 组合模板并调用真实 Nest service；failAt 通过测试依赖注入拦截指定 page.create，不增加生产故障参数。
- [ ] 提取 createFolder 的名称、祖先、数量、portable path、重复检查至 createFolderLocked，保持 Folder 数据和 Sync wire 语义。既有 createFolder 继续推进一次，回归原 Folder 测试。
- [ ] 实例化按现有锁顺序：live human → Space advisory/content-tree lock → Space 权限 → 实例幂等 → 模板版本 → 父优先 Folder → placePage/Page → 一次 advancePageMutation(structural:true) → 映射/绑定/Run。所有服务收到同一 tx，禁止内部 $transaction。
- [ ] 复用现有路径分配器处理重名；既有 Folder 同名策略为拒绝。校验模板深度加父目录深度不超过当前 Folder 上限。保留模板内部排序，不把模板元数据写入 Folder。
- [ ] 实例幂等成功回放先于过期 preview 校验，但仍检查用户当前访问权；匹配相同规范化 payload 才返回原结果。修正 payload 必须新 key。
- [ ] 初始阶段 collaborationEnabled:true 返回功能未启用，整个事务拒绝；任务 8 接入运行后开放。不能返回页面组成功却丢掉 Run。
- [ ] 运行 instantiation DB、新单元测试和 `scripts/content-tree-core-db.test.mjs` 隔离回归，通过后提交。Folder 回归必须显式设置专用 FOLDER_TEST_DATABASE_URL 并确认零跳过；新 DB 测试使用 PAGE_TEMPLATE_TEST_DATABASE_URL 和既有随机 schema helper。

## Task 6: 长期绑定与参与者计算

**Files:** 新建 `apps/server/src/page-templates/page-agent-binding.service.ts`、`.spec.ts`、`run-page-selection.ts`、`.spec.ts`。

**Interfaces:** `setBindings(tx,spaceId,edits,principal)`，edit 为 `{pageId,agentId:null|string,roleSlotKey:null|string,expectedUpdatedAt:null|string}`；`resolveParticipants(tasks,bindings)` 返回 `{assignments,agentIds,issues}`，task 为 `{nodeId,roleSlotId,enabled}`，binding 为 `{roleSlotId,agentId}`。

- [ ] 写测试：reader/跨 Space/停用 Agent 被拒绝；暂无在线会话但凭据有效的 Agent 可长期绑定；expectedUpdatedAt 过期失败；批量任一项失败全部回滚。
- [ ] 实现 setBindings 前检查人类现有内容权限和 AgentGrant 派生权限，每次变更记录 before/after/actor；解除只删除当前关系，保留事件和 Run 快照。
- [ ] 写参与者纯函数测试并实现只收集启用任务使用的 binding：

```ts
expect(resolveParticipants([
 {nodeId:'a',roleSlotId:'writer',enabled:true},
 {nodeId:'b',roleSlotId:'unused',enabled:false},
], [{roleSlotId:'writer',agentId:'agent-a'},
 {roleSlotId:'unused',agentId:'agent-b'}]).agentIds).toEqual(['agent-a']);
```

- [ ] 同角色多页面默认 Agent 不一致返回 ROLE_BINDING_CONFLICT；启用任务缺绑定返回 ROLE_BINDING_REQUIRED；显示预览后由用户本次映射解决。
- [ ] 批量范围请求包含明确 pageIds、expectedTreeRevision、各 binding 的版本；预览后新增子页不被自动纳入。读取页面所属 Space，不能信任提交 ID。
- [ ] 运行两份新测试、原权限角色和协作改派测试，通过后提交。

## Task 7: 从现有目录保存模板与来源一致性

**Files:** 新建 `apps/server/src/page-templates/folder-template-snapshot.service.ts`、`.spec.ts`、`scripts/composite-template-snapshot-db.test.mjs`。

**Interfaces:** `preview(spaceId,rootFolderId,selection,principal)` 返回树、角色、警告和 sourceToken；`save(spaceId,input,principal)` 在事务内复核 token 并插入模板版本。sourceToken 包含树 revision、每页持久化版本/哈希和所选来源 workflow 版本，不接受客户端正文。

- [ ] 写 DB 测试：预览后只修改页面正文但未改变 tree revision，save 必须 SOURCE_CHANGED；排除父目录会连同其子节点排除，禁止孤儿。
- [ ] 明确来源 union：`{kind:'structure_only'}`、`{kind:'template',versionId}`、`{kind:'legacy_workflow',templateId,version,taskTargets}`、`{kind:'simple_pages'}`。structure_only 移除所有角色/协作；simple_pages 为每个选中且分配职责的 Page 生成一任务一人类 gate。
- [ ] 复制节点时生成模板内 ID，保留层级/顺序/已保存 Markdown；只序列化字段白名单。模板结构元数据不含 Agent/Credential/Run/Artifact/Review ID；正文保持原快照，界面提醒用户清理正文内的具体项目资料。
- [ ] 附件检测只读取现有关系/正文识别能力，输出 ATTACHMENTS_NOT_COPIED 与 affectedPageIds；继续保存需明确确认该警告。保留原引用、不复制或改写；提示实例中的图片可能继续引用原资源，不保证模板便携性。
- [ ] 核心纯函数断言：

```ts
const saved = snapshotDefinition(source, {kind:'structure_only'});
expect(saved.collaboration).toBeNull();
expect(saved.nodes.filter(n=>n.kind==='page').every(n=>n.roleSlotKey===null)).toBe(true);
```

`snapshotDefinition(source,policy)` 是此任务在 service 同文件导出的纯结构转换函数，source 为服务端读取的节点快照，不负责权限或事务。
- [ ] 运行单元和 snapshot DB 测试；验证命名、100 模板限制、归档恢复、sourceLocale 和版本不可变，提交。

## Task 8: 事务内创建运行与外部 Agent 指令

**Files:** 新建 `apps/server/src/collaboration-workflows/run-expansion.service.ts`、`.spec.ts`；修改 `run.service.ts`、`collaboration-workflows.module.ts`、`execution.service.ts`、`apps/server/src/mcp/collaboration-mcp.spec.ts`；接入任务 5/6 服务。

**Interfaces:** `RunExpansionService.createStarted(tx,input,principal)` 返回 runId；input 为 `{spaceId,name,source,definition,inputs,bindings,taskPageIds}`，source 取任务 2 来源 union，taskPageIds 是 taskNodeId→actualPageId。

- [ ] 从现有 RunService.expandRun 提取保持行为的内部展开逻辑；原 create/start 复用，保留事件幂等、Todo、generation、依赖及审核产生时机。
- [ ] 新建创建时 Run 不要求必填旧 templateId；page_selection 为历史页面/普通模板单页生成冻结流程，无需创建伪模板或假 TemplateInstantiation。
- [ ] 在事务内调用现有 Agent 准备预检及 reviewer 校验。仅持久化启用任务使用的角色；启用 blocked 的下游任务也属于参与者，不能只取当前 ready 状态。
- [ ] 写测试：绑定服务修改长期 Agent 后，Run task assignee 不变；同 Agent 负责两个任务，joinInstructions 长度为 1；范围外 Agent 不出现在 roleBindings 和加入资格中。
- [ ] 从任务 5 事务调用 createStarted，故障注入 expandRun 失败时树也回滚；历史页面启动只创建 Run，不创建页面副本。
- [ ] 页面目标和基线只来自服务器映射；MCP join/claim 返回任务目标页面、授权上下文及明确输出要求，客户端提交不能任意更换 targetPageId。依赖页上下文不扩大 AgentGrant。
- [ ] 运行 RunExpansion、新旧 run/execution/mcp 契约测试，再运行 instantiation DB 的 collaborationEnabled:true 分支，通过后提交。

## Task 9: 页面 Artifact、ChangeSet 与一次原子审核

**Files:** 新建 `apps/server/src/collaboration-workflows/page-result.service.ts`、`.spec.ts`；新建 `apps/server/src/review/page-publication.service.ts`、`.spec.ts`；修改两处 `review.service.ts` 与协作 `execution.service.ts`；新建 `scripts/collaboration-page-publication-db.test.mjs`。

**Interfaces:** `PageResultService.proposeLocked(tx,task,attempt,artifact,principal)` 创建唯一关联；`PagePublicationService.publishLocked(tx,changeSetId,reviewer)` 返回 `{pageId,pageVersionId}`；原页面发布调用该事务原语，外围效果由外层提交后处理。

- [ ] 先建立旧 Markdown update_page 发布的特征测试，再提取其版本、索引事件、知识版本、权限和树 revision 操作；不复制另一套 Page 更新算法。
- [ ] 编写数据库失败案例：审核后 PageVersion 写失败，Artifact/Review/ChangeSet/Approval/Page/Run 全部保持原值；失败后重试仍只一份有效结果。
- [ ] 领取时将 page 当前版本 ID、更新时间和 canonical hash 冻结在 Attempt。使用当前 PageVersion 实际结构，不假设 Page 自带递增 version 字段；Page 没有历史版本时显式冻结 nullable versionId 加 updatedAt/hash。
- [ ] 提交只允许页面目标任务的 Markdown 输出。复用租约、任务 generation 与结果幂等检查；同事务创建 pending Artifact、origin=collaboration 的强制审核 ChangeSet 和唯一 Link，publisher 也不能 autoPublish。
- [ ] 页面目标任务在编译时规范为一个页面发布人类 gate；旧流程需要多个审核意见时由前置任务表示，禁止悄悄删掉旧人工 gate。升级含多个必要人类 gate 的旧模板时返回明确校验问题供编辑。
- [ ] 从协作 decide 调用 publishLocked，在同一 tx 写 Review、Artifact、ChangeSet、PageVersion、Approval、progression。普通 Review 入口的 approve/reviewPublish/publish/decideItem/Agent autopublish 检测 Link 后拒绝绕过并返回协作审核链接。
- [ ] 页面未改动时单次成功，另一并行分支依旧运行；过期 Reviewer、撤权、重复批准均测试。通过以下断言后提交：

```js
assert.equal(after.review.status,'approved');
assert.equal(after.artifact.status,'accepted');
assert.equal(after.changeSet.status,'published');
assert.equal(after.page.content,submittedMarkdown);
assert.equal(after.approvals.length,1);
```

after 在 DB fixture 调用真实协作 decide 后读取，禁止用 mock 返回值作原子性证据。

## Task 10: 页面冲突、代际失效与撤权恢复

**Files:** 修改 `page-result.service.ts`、协作 `review.service.ts`、`progression.service.ts`、`run.service.ts`、`review.dto.ts`；新建 `page-result-conflict.spec.ts` 与 `scripts/collaboration-page-conflict-db.test.mjs`。

**Interfaces:** `resolvePageConflict(spaceId,runId,taskId,{kind:'regenerate'|'adopt_current',expectedPageVersionId,expectedContentHash,idempotencyKey},principal)`；返回重新生成的 generation 或被采用 PageVersion 的 accepted artifact 引用。

- [ ] 写并发测试：Agent 领取后人类编辑，再批准返回 PAGE_VERSION_CONFLICT，Page 内容不变、Review pending、Run paused 且 pauseReason 可读。
- [ ] 冲突状态必须提交：事务内返回领域结果，再在事务外映射 HTTP 409；禁止“先写 paused 再抛错”导致暂停一起回滚。
- [ ] regenerate 使用既有驳回代际机制，废止旧租约、旧 Artifact、Review、Link/ChangeSet；新 Attempt 读取最新 Page 基线。下游输入不能再消费旧代 accepted 产物。
- [ ] adopt_current 同事务复验当前页面版本/hash 与 reviewer 权限，旧 ChangeSet 标记 superseded；新 accepted Artifact 内容/引用来自当前 PageVersion，并明确人类采用来源。不能把旧 Agent 文本标成已发布。
- [ ] 运行取消、驳回、人工改派、页面归档/删除/移出 Space 均废止不再有效的 pending 发布链接。撤权在每次领取、提交和审核时实时检查，不随快照冻结授权。
- [ ] 并行运行针对同一页：只允许一份匹配基线的发布成功，另一份冲突；双人同时 adopt/approve 只能一个决定成功。运行冲突 DB 与原代际/改派测试，通过后提交。

## Task 11: 对外 API、三步创建与历史页面入口

**Files:** 新建 `apps/server/src/page-templates/composite-template.controller.ts`、`.dto.ts`、`.controller.spec.ts`；新建客户端 `features/page-templates/compositeTemplateApi.ts`、`TemplateTreePreview.tsx`、`CollaborationSettingsPanel.tsx`、`PageAgentBindingDialog.tsx` 及同名 `.spec.tsx`；修改 `NewPageDialog.tsx`、`features/space/SpaceView.tsx`、`features/page/PageEditor.tsx`、`features/content-tree/ContentTree.tsx`、`i18n/messages.ts`。

**Interfaces:** API 路由采用设计第 10 节；预览结果包含 definitionHash、treeRevision、节点、task assignments、participants、issues；实例化返回任务 5 结果。DTO 拒绝未知字段，locale 显式提交；失败 code 与错误文本分别管理。

- [ ] 控制器测试拒绝 Agent、Viewer、跨 Space、伪造 preview 内容；preview 不持久化模板/页面/Run。
- [ ] UI 测试默认协作 off，卡片筛选 single/page_group 和 scope 独立；选组合后显示完整层级，off 提交不携带角色映射；on 显示角色、启用任务、去重参与者。
- [ ] 使用现有 RoleBindingEditor、AgentPreparationDialog、ConnectionInstructionPanel 复用准备和映射。新建按钮按状态显示创建或创建并启动；结果明确区分 Run 已启动与外部 Agent 尚待用户唤醒。
- [ ] reducer 明确 `select → preview → configure → submitting → result`；提交阶段禁重复调用；网络结果未知时保留 key 原样重试，用户修改输入生成新 key。浏览器取消只停止等待，不声称服务端事务已取消。
- [ ] 页面绑定弹窗“立即启动”默认关闭，明确保存绑定和绑定并启动；已有 Agent badge 可改绑/解绑，Folder 批量设置先预览 pageIds 与旧绑定版本。
- [ ] 组件行为测试示例（在原 renderDialog fixture 上扩展）：

```tsx
fireEvent.click(screen.getByRole('button',{name:'项目管理工作区'}));
fireEvent.click(screen.getByRole('button',{name:'下一步'}));
expect(screen.getByRole('checkbox',{name:'启用 Agent 协作'})).not.toBeChecked();
expect(screen.getByText('风险与阻塞')).toBeVisible();
```

- [ ] 实现中文英文完整键、键盘选择、树层级语义、焦点恢复、390px 单列；目录请求失败保留空白页面入口。运行相关 Vitest、服务 controller 测试和 typecheck 后提交。

## Task 12: 模板管理、升级与审核界面

**Files:** 新建客户端 `features/page-templates/SaveFolderAsTemplateDialog.tsx`、`UpgradeWorkflowTemplateDialog.tsx` 及测试；修改 `PageTemplateManager.tsx`、`features/collaboration/CollaborationWorkspace.tsx`、`RunStartWizard.tsx`、`RunDashboard.tsx`、`components/ReviewPanel.tsx` 和 `features/collaboration/types.ts`、`i18n/messages.ts`。

**Interfaces:** 保存目录界面消费任务 7 preview/token；升级消费任务 4 API；ReviewPanel 消费 pageTarget/changeSetLink/conflict/canDecide，决定仍只有一个协作审核入口。

- [ ] 测试保存目录排除节点、职责转换、source_changed 刷新、附件警告确认；structure_only 不显示协作角色。已保存文本和未保存编辑分别提示，不上传客户端正文当权威。
- [ ] 旧自定义协作列表显示“待升级”，保留旧启动；升级通过任务映射校验后进入统一目录。系统/Space 模板的元数据修改、内容新版本、归档恢复继续沿用 Owner/Admin 权限。
- [ ] 新组合模板从协作目录启动也进入同一个创建流程，不生成孤立旧 Run；既有页面组“启动下一次协作”复用当前 ID 映射，不重复实例化页面。
- [ ] ReviewPanel 显示目标页、基线、修改 diff 与一次批准；冲突展示 regenerate/adopt_current 两个准确动作以及版本摘要。普通 ChangeSet 详情显示“前往协作审核”，不留可绕过发布按钮。
- [ ] 测试更换 Page 负责人后 RunDashboard 仍显示冻结负责人和已有任务；权限不足保留只读可见信息。跑相关 Vitest 及旧 RunStartWizard/ReviewPanel 回归，通过后提交。

## Task 13: 提交后效果、灰度与完整验收

**Files:** 新建 `apps/server/src/page-templates/template-effects.service.ts`、`.spec.ts`、`template-feature-policy.ts`、`.spec.ts`；修改 `page-template.module.ts`、`apps/server/src/worker.ts`、客户端目录能力读取；新建 `scripts/composite-template-e2e.mjs`、`docs/verification/composite-template-acceptance.md`。

**Interfaces:** `TemplateEffectsService.drain()` 消费任务 2 TemplateEffectJob；`TemplateFeaturePolicy.canCreate(spaceId)` 根据服务端精确 Space allowlist；API 返回 capability，客户端不得自行绕过 flag。

- [ ] 实例创建事务写持久 effect 行（page index、Space graph、run notification），worker 在提交后尝试，失败指数退避、最多 8 次后记录失败供重试；去重键固定实例/资源/效果。通知内容只含必要 ID。
- [ ] 测试队列第一次失败重试成功；API 创建响应始终返回已提交成功，页面不重复。Socket 用当前数据库状态补偿重连，不能以消息送达判断运行真相。
- [ ] gate 默认关闭新创建/新模板写入；flag 关闭仍允许既有新 Run 读取、执行、审核、恢复。模拟关闭后完成已启动运行，并验证旧目录可用，禁止旧服务降级为回滚策略。
- [ ] 使用现有 E2E isolation predicate 和专用随机 schema 建 HTTP 测试环境，复用 collaboration-real-agent-harness；脚本须缺环境 fail-closed，清理只限创建的 fixture/schema，不使用生产 URL。
- [ ] 真实 Chrome 跑六条设计 15.4 场景，桌面和 390px、中文英文各覆盖关键入口；至少两名真实外部 Agent 完成领取、提交和一轮人类审核。协议 fixture 与真实 Agent 分开记录，缺少可用外部 Agent 时不能写真实 E2E PASS。
- [ ] 特别验收绑定外 Agent 不在提示词/加入名单，用户仅唤醒各参与 Agent 一次；提示词逐个驱动原 MCP 领取和状态等待，不用模拟 UI 点击证明执行。
- [ ] 执行最终验证：

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm test:full
node --test scripts/composite-template-schema-db.test.mjs scripts/composite-template-instantiation-db.test.mjs scripts/composite-template-snapshot-db.test.mjs scripts/collaboration-page-publication-db.test.mjs scripts/collaboration-page-conflict-db.test.mjs
node scripts/composite-template-e2e.mjs
```

- [ ] 将新增 DB 测试纳入 repository-test-harness 的明确数据库测试清单，验证测试数量和必要门禁未跳过。真实 Agent harness 不能被普通全仓测试意外付费调用。
- [ ] 审查 diff，核对本计划的每项验收证据。记录未通过项和原因、feature flag 回滚验证、DB 迁移 dry run 结果；本地精确提交。GitHub/npm/生产仍按各自授权处理。

## 覆盖检查与交接

| 设计章节 | 对应任务 |
|---|---|
| 1–4 架构与模型 | 2、3、6、8 |
| 5 系统模板 | 4 |
| 6 创建、后绑定、保存 | 5–8、11、12 |
| 7 权限 | 2、6、8–11 |
| 8 原子事务与幂等 | 5、8、13 |
| 9 单次审核与冲突 | 9、10、12 |
| 10–11 API 与数据 | 2、11 |
| 12 迁移 | 2、4、12 |
| 13 UI/错误 | 11、12 |
| 14 灰度回滚 | 13 |
| 15 验收 | 各任务测试 + 13 |
| 16–18 范围与门禁 | 1、全局约束 |

计划中的命令、fixture 和新文件均为实施任务说明，当前未执行实现测试。执行者按任务顺序完成红灯、实现、绿灯、审查及精确提交；普通进度无需再次确认。当前用户授权的是设计确认及实施计划，编码需用户明确继续实施。
