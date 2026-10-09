# F6 Admin 模板创建能力投影修复

## 变更

只改 composite-template-catalog.service.ts 和对应 spec.ts。canCreate 的 Human Space role allowlist 加入 admin，与 AuthorizationService.humanAllowedRoles 对 editor gate 的处理一致。canManage 不变，principal.agentId 防御不变。无 commit、build、runtime 启停。

## RED

命令（agentwiki 目录）：
`pnpm --filter @agentwiki/server test --runTestsByPath src/page-templates/composite-template-catalog.service.spec.ts`

先只改测试。结果 1 failed / 21 passed；唯一失败为 human admin，预期 canCreate:true，实际 false，canManage:true。原始日志 admin-template-capability-red.log 保留。测试子命令 exit 1（外围 tail 命令 exit 0 不代表测试成功）。

## GREEN

加入生产 allowlist 的 admin 后运行：
`pnpm --filter @agentwiki/server test --runTestsByPath src/page-templates/composite-template-catalog.service.spec.ts src/page-templates/template-instantiation.service.spec.ts src/core/authorization/authorization.service.spec.ts`

3 suites / 79 tests 全部通过，日志 admin-template-capability-green.log。git diff --check 通过。

新增覆盖：human owner/admin/editor/viewer 字面预期矩阵；Agent 在四种返回角色下始终不暴露 human canCreate/canManage；nonmember super_admin 的 viewer 投影保持双 false。

## 相邻检查

server capability role 投影搜索只有该 canCreate；legacy page-template.service.ts 的 canManage 已包含 owner/admin。客户端 NewPageDialog.tsx:200 与 PageTemplateManager.tsx:152-153 都消费服务端 canCreate，没有发现另一个独立 role allowlist 遗漏。本次不修改客户端。

## 局限

catalog 单测沿用 mock authorization，Agent 矩阵是防御断言，并不表示真实 human gate 接受 Agent。nonmember super_admin 测试覆盖 shared authorization 返回 viewer 后的投影，不冒充真实 DB membership 验证。共享授权与实例化既有单测同时通过。实际新构建 Admin 复合模板 UI 10 例由 root 独立复验，本文不声称已完成。
