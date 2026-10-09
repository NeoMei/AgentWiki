# Task 3 模板/绑定能力契约候选

- BASE: e039fb652fd0d5f53bbd6d922a5cb7d05010cce1
- CANDIDATE: 7bf983ccd6f6e980558ee7e8a7bac0808642881a
- 主候选工作树: `/Users/neomei/.codex/worktrees/test-fixes-20261008/AgentWiki `（尾空格）
- 状态: 实现、自审、针对性回归与类型检查完成；独审/浏览器验收交由控制器。没有发布、生产迁移、改变 allowlist、读取凭据或停止 3191/5191。

## 对外接口 / Task 4、5

`GET /spaces/:spaceId/templates` 的 `capabilities` 保留旧 `canManage` / `canCreate`，新增四字段；不是一个总开关：

| 动作字段 | owner | admin | editor | viewer | allowlist |
|---|---|---|---|---|---|
| canCreate（普通页面组创建） | true | true | true | false | 无关 |
| canManage（原模板管理角色） | true | true | false | false | 无关 |
| canManageDefinitions（组合定义写、旧工作流升级） | true | true | false | false | 必须 |
| canSaveFolderTemplate（目录保存模板） | true | true | false | false | 必须 |
| canBindAgent（纯保存/删除页面与目录绑定） | true | true | true | false | 无关 |
| canStartPageCollaboration（现有页面/目录启动） | true | true | true | false | 必须 |

表中 allowlist 必须的行仅在配置包含精确 Space ID 时 true。Agent 所有能力 false。未开放 Space 的合法 editor 可纯绑定、可普通组创建，不能启动现有页面协作或保存目录模板。

admin 差异核实：PageAgentBindingService 表面传 `['owner','editor']`，但 `AuthorizationService.humanAllowedRoles` 会给包含 editor 的权限列表补入 admin。因此实际纯绑定也允许 admin；本候选未修改原权限边界。真实 AuthorizationService 驱动的控制器 + 服务矩阵覆盖了该行为，避免仅按表面数组推断。

客户端 `CompositeTemplateCapabilities` 新字段可选，API parser 将缺失或非 boolean true 归 false；所有受限动作严格 `=== true`。PageAgentBindingDialog 新增可选 `capabilities` prop，缺失默认拒绝绑定及启动。SpaceView / PageEditor 传入同身份能力。能力撤回会清除已勾选的启动及预览；现有 CAS 与原子 start payload 保留。

ContentTree 新增 `saveFolderTemplateDisabledReason?: string`，菜单内禁用目录模板按钮并显示原因，通过 aria-describedby 关联；未改 Task 1 TreeActionMenu 互斥、定位/几何逻辑。PageTemplateManager 定义写使用 canManageDefinitions，旧内容模板仍按原 canManage。CollaborationWorkspace 旧模板升级已改用 canManageDefinitions，普通组新建继续 canCreate。

## TDD 证据

1. catalog 新角色×allowlist矩阵先 RED：8 项失败（四动作字段缺失）。
2. binding dialog 关闭/缺失启动先 RED：3 项失败（启动仍能勾选、无绑定权限仍能保存）。
3. SpaceView / PageEditor / ContentTree RED：关闭目录模板仍能点击；旧 role-only 能力仍显示绑定入口。修正后 GREEN。
4. PageTemplateManager 定义管理 false/缺失 RED：2 项失败（仍显示定义编辑/归档）。修正后 GREEN。
5. 真实授权驱动绑定矩阵 RED：admin route 实际成功但 projected capability=false，共 2 项失败。修正投影后 GREEN，未扩权限。
6. API 缺失/非 boolean 动作和启动能力撤回 RED：3 项失败。修正后 GREEN。
7. Legacy upgrade 在 canCreate=true / canManageDefinitions=false或缺失先 RED：2 项失败。修正后 GREEN。

## 验证命令（cwd = 工作树/agentwiki）

- `pnpm --filter @agentwiki/server test -- composite-template-catalog.service.spec.ts template-feature-policy.spec.ts composite-template.controller.spec.ts page-agent-binding.service.spec.ts existing-run-orchestration.service.spec.ts folder-template-snapshot.service.spec.ts page-template.service.spec.ts template-instantiation.service.spec.ts`
  - 8 suites、243 tests PASS；包括定义管理、目录保存、纯绑定、现有页面启动各 8 行 role×allowlist 实际控制器 + 服务 + AuthorizationService 矩阵。
- `pnpm --filter @agentwiki/client exec vitest run src/features/page-templates src/features/content-tree/ContentTree.spec.tsx src/features/content-tree/TreeActionMenu.spec.tsx src/features/space/SpaceView.spec.tsx src/features/page/PageEditor.spec.tsx src/i18n/page-template-messages.spec.tsx`
  - 22 files、533 tests PASS。
- `pnpm --filter @agentwiki/client exec vitest run src/features/collaboration/CollaborationWorkspace.test.tsx`
  - 1 file、32 tests PASS（补齐 legacy upgrade 后）。
- `pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/PageAgentBindingDialog.spec.tsx`
  - 最后收尾重跑 20 tests PASS。
- `pnpm --filter @agentwiki/server typecheck` PASS。
- `pnpm --filter @agentwiki/client exec tsc --noEmit` PASS（legacy upgrade 与最后预览清理后重跑）。
- 修改的 9 个 client production 文件、2 个 server production 文件 focused eslint PASS。
- 显式 `git --work-tree='.../AgentWiki ' diff --check` PASS。

## 自审 / 限制

- 没有改 controller/service 写权限、COMPOSITE_TEMPLATE_SPACE_ALLOWLIST 默认值或运行环境配置。
- 不触碰 Task2 MarkdownWorkspace / AgentSessionPanel；PageEditor 只有模板绑定能力读取/入口/传参的局部变更。
- 不触碰 Task4 RunService/types/Review组件/system-collaboration-messages。
- 自审已关闭 legacy upgrade 已知错误消费者；该工作只授权本地实现，不声明浏览器验收或真实 Agent 连接通过。
- Task1 TreeActionMenu 的既存 no-unused-expressions lint 由 root 处理；本任务未改该文件。
- 报告属于 `.superpowers/sdd` 本地 ledger，不纳入产品 commit。
