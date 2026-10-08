# Task 3 本地真实 API + Chrome 验收

结论：PASS。未发现本次能力契约范围内的产品问题。owner 未 allowlist 可保存绑定；现有页面协作启动、目录保存模板均禁用并显示中文解释。真实 editor / viewer 补充检查通过。

## 候选与环境

- 验收候选 HEAD：`d872065a5addfbf6b7aa295f53d2ab458f4a02b8`（包含 Task 3 `7bf983cc`）；结束时重新核对 HEAD 相同。
- 工作树：`/Users/neomei/.codex/worktrees/test-fixes-20261008/AgentWiki `（尾空格）。
- API：`http://127.0.0.1:3191/api`；Vite：`http://127.0.0.1:5191`；父任务提供的专用本地库 `agentwiki_test_20261008_ui_final`。
- Playwright 1.62.1，独立 `channel: chrome`、headless 隔离 browser context，桌面 1600 × 1000。Browser plugin not available；任务明确允许隔离 Playwright Chrome。没有使用用户既有浏览器。
- fixture 仅在脚本内存使用，结果 JSON、截图及本报告无 token。真实 API，无 route mock、无真实 provider、未修改 allowlist。
- 新建专用 Agent、editor Grant、目录、两篇页面和两个测试成员；主 fixture 三篇页面及 owner 身份未改。

## 真实 API 能力矩阵

`GET /spaces/:spaceId/templates?locale=zh-CN` 实际返回：

| 真实成员身份 | canManage | canCreate | canManageDefinitions | canSaveFolderTemplate | canBindAgent | canStartPageCollaboration |
|---|---|---|---|---|---|---|
| owner | true | true | false | false | true | false |
| editor（新增测试成员） | false | true | false | false | true | false |
| viewer（新增测试成员） | false | false | false | false | false | false |

Agent 经 `POST /agents` 创建，`PUT /agents/:id/grants/:spaceId` 赋 editor Grant。未生成 Agent 凭据，Agent 显示“未连接”。

## 用户链路与证据

1. Space 正文目录树 → 专用目录“更多”菜单：`将目录保存为模板` disabled，`aria-describedby` 关联可见中文理由“当前 Space 未开放目录保存为模板。”。点击触发器前与菜单打开后均通过 `elementFromPoint` 核实目标未被遮挡，截图人工复核菜单未被裁剪、理由完整可读；只操作目标菜单，没有点击删除。
2. 侧栏展开专用目录 → 打开专用页面 → 点击“编辑” → “Agent / 协作设置”：真实 Dialog 加载当前绑定及成员；选择 `Task3 本地验收 Agent`。
3. “保存后立即启动协作” disabled 且未勾选；中文理由“当前 Space 未开放现有页面协作启动，仍可保存 Agent 绑定。”可见；“保存绑定” enabled。
4. 点击保存产生真实 `PUT /api/spaces/cmuzis41g0008ig686jq6zan4/pages/e11b1d56-3eb6-404d-807d-980189a581da/agent-binding`，HTTP 200，发送 `agentId`、`roleSlotKey: owner`、`expectedUpdatedAt: null`、`expectedTreeRevision: 6`。对话框关闭。
5. 独立 GET 回读 Agent ID 为 `agent_097004b520fbe65ce5d2a923903349af`；刷新浏览器重新打开 Dialog，下拉选择与当前 Agent 均仍为该 Agent。第二次 GET `updatedAt` 仍是 `2026-10-08T12:40:58.887Z`。
6. 整条 owner 浏览器流程抓取的实际 API 请求中没有 POST collaboration-runs 或 /start；所有 API 状态 <400，pageerror 与 warning/error console 均为 0。
7. 新 editor 通过真实 API 为第二篇专用页面保存绑定 HTTP 200；Chrome 打开其编辑页 Dialog，当前绑定正常显示、保存 enabled、启动 disabled。
8. 新 viewer 对同第二篇页面 PUT 绑定返回 HTTP 403 `SPACE_ACCESS_DENIED`；Chrome 阅读页内容正常，无编辑按钮、无绑定设置入口。两个角色浏览器均无 pageerror。

| 检查 | 结果 |
|---|---|
| 页面 URL / title 为目标本地 AgentWiki | PASS |
| 非空内容、无 Vite error overlay | PASS |
| owner console warning/error、pageerror | 0 |
| owner 实际 API 失败请求 | 0 |
| 实际保存 → 刷新 → API/界面回读 | PASS |
| 未发生 start 请求 | PASS |
| 目录禁用和中文理由 / 遮挡检查 | PASS |
| editor 允许、viewer 拒绝的真实身份检查 | PASS |

## 原始文件

- `/tmp/agentwiki-1008-ui/task3-ui-results.json`：owner 完整结果，包含脱敏网络状态、PUT body、GET 回读与点击几何。
- `/tmp/agentwiki-1008-ui/task3-roles-results.json`：editor / viewer 真实能力、HTTP 和 UI 回读。
- `/tmp/agentwiki-1008-ui/task3-resources.json`：无 token 的专用资源标识。
- `/tmp/agentwiki-task3-bootstrap.cjs`、`/tmp/agentwiki-task3-ui.cjs`、`/tmp/agentwiki-task3-roles.cjs`：验收脚本。
- `/tmp/agentwiki-1008-ui/task3-folder-template-disabled.png`：正文目录菜单的禁用状态和中文理由。
- `/tmp/agentwiki-1008-ui/task3-binding-start-disabled.png`：未绑定初始状态、选择 Agent 后仍禁启动但可保存。
- `/tmp/agentwiki-1008-ui/task3-binding-persisted.png`：刷新后绑定持久化。
- `/tmp/agentwiki-1008-ui/task3-editor-role.png`、`/tmp/agentwiki-1008-ui/task3-viewer-role.png`：真实角色页面证据。

所有五张正式截图已人工查看。早期脚本尝试的失败证据保存在 `task3-ui-attempt1/2/3-results.json` 与对应 attempt 图片：分别是未限定双份目录 selector、误用缺少模板动作的侧栏菜单、打开阅读页后遗漏点击编辑。只调整 /tmp 验收脚本后完成流程；这些是测试定位/步骤错误，未改产品代码，也没有将其算为产品通过证据。bootstrap 首次遗漏必填 locale 得 400，补上查询参数后正式验收均使用合法请求。

## 边界与资源

- 本报告覆盖未 allowlist owner/editor/viewer 的真实授权和桌面 UI；未改变配置来验收 allowlist=true、admin、Agent 身份矩阵，未测试移动视口或真实模型运行。
- 无产品源码/Git 修改、无生产访问、无部署、无插件安装。只写指定本地 ledger 和 /tmp 证据。
- 所有自建浏览器已关闭。API 3191 / Vite 5191 保留供父任务继续；专用合成资源保留在父任务测试库，交由父任务统一清理。
