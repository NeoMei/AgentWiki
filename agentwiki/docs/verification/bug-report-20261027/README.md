# 10-20 测试报告候选补修（2026-10-27）

原报告：https://agentwiki.quukk.com/pages/aa1739e9-092e-4b61-a4a1-8c63d634817a

基线为锁定候选分支 `codex/agent-autochat-external-opencode` 的 `d4dd13d12a8f6b0ed7867199f51bd552af6b5645`，包版本仍为 0.12.62。历史报告中的发布声明不作为本轮新修复的发布证据。

## 逐项结果

| 报告项 | 本轮结果 |
| --- | --- |
| 1 登录校验 | 实际 `/login` 重定向后的首页 ProductPage、独立 Login 都统一页面内校验；关闭原生气泡、只提示并聚焦首个无效字段，邮箱格式错误在请求前阻断。 |
| 2 注册校验 | 实际首页注册表单、独立 Register 共用验证器；按名称、邮箱、密码顺序处理，错误样式和可访问性提示一致。 |
| 3 空白名称/密码 | 保留前后端已有空白字符规则，补齐实际入口的字段错误和首错聚焦；正常输入/空白/全角空格/格式边界有回归。 |
| 4 失效笔记删除 | 阅读侧栏补接 onDelete；删除队列使用最新同步版本，重复删除不会重发旧版本请求，不修改正文。 |
| 5 任务删除 | 保留已有确认及递归删除；阻止删除仍被其他任务依赖的子树；共享空间事务锁串行化板内写入，并在等待后重新确认成员权限。 |
| 6 任务改名 | 当前候选已有名称编辑、保存和取消，本轮补验卡片/详情/列表一致更新和权限边界。 |
| 7 目录排序 | 修正 after 错发目标本身为 beforeId；现在使用下一同类兄弟或末尾追加。消除页面行中间落点死区，插入线贴合行，增加菜单上移/下移及只读/过滤提示。 |

## 验证证据

- 客户端最终定向测试：20 文件、359 项通过。另有独立空间路由/目录集成复测 74 项通过，覆盖范围有重叠，不累加为总数。
- 服务端认证：18 项通过；任务板/MCP：5 套件、62 项通过，含 4 项真实 PostgreSQL 场景，见 `taskboard-db.json`。
- 目录服务真实 PostgreSQL：38 项通过、0 跳过，见 `content-tree-db.json` 与 `.log`。验证 beforeId 持久化、跨目录路径、并发冲突及权限重验。
- Chrome 实际首页认证入口：28 个无效提交场景通过，原生校验事件 0、认证请求 0，见 `auth-browser.json`。未创建账号或操作已有登录会话。
- Chrome 目录组件：6 项通过，包含页面/文件夹前后排序、末尾、跨目录、键盘菜单、过滤、只读与 390px 菜单。该浏览器 fixture 不连接 API；落库证据来自上述独立 PostgreSQL 测试，不声称完成生产 UI 到数据库的全链路验收。
- `pnpm build`、`pnpm typecheck`、修改文件 ESLint、release guard、`git diff --check` 全部通过。未放宽 bundle budget；初始 JavaScript 为 550990/551000 bytes。既有 Mermaid 循环 chunk 警告仍存在。
- 独立代码审查发现的实际入口遗漏、邮箱格式、任务并发及成员撤权问题均补修。Agent 凭据/Grant 撤销语义未改变，不纳入本轮撤权场景声明。
- 本任务创建的临时 PostgreSQL 数据库均删除并回查不存在；未触碰生产数据。

## 可重跑命令

```sh
pnpm --filter @agentwiki/client exec vitest run src/features/auth src/features/about/ProductPage.spec.tsx src/features/page/usePersonalNotes.spec.tsx src/features/page/PersonalNotesPanel.spec.tsx src/features/page/PagePreview.spec.tsx src/features/agent-session/AgentReadingSidebar.spec.tsx src/features/taskboard src/features/content-tree src/features/space-workspace/SpaceDirectory.spec.tsx src/features/space-workspace/SpaceWorkspace.navigation.spec.tsx src/features/space-workspace/SpaceWorkspace.mutations.spec.tsx
AGENTWIKI_WEB_URL=http://127.0.0.1:5189 pnpm --filter @agentwiki/client exec playwright test e2e/content-tree-reorder.spec.ts e2e/content-tree-menu.spec.ts
TASKBOARD_TEST_DATABASE_URL=<专用本地agentwiki_taskboard_*数据库> pnpm --filter @agentwiki/server exec jest --runInBand project-taskboard taskboard-mcp
FOLDER_TEST_DATABASE_URL=<专用本地测试数据库> node --test --test-reporter=tap scripts/content-tree-operations-db.test.mjs
pnpm build
pnpm typecheck
node scripts/agentwiki-release-guard.mjs
```

## 交付边界

本轮完成源码修复、本地验证和原报告回复；没有版本升级、推送、合并或生产部署。生产实际空提交、失效笔记删除、任务改名/删除以及目录拖动后刷新，仍需在部署此修复后验收。不得把既有 v0.12.56/v0.12.62 的发布回执当成本轮修复已上线。
