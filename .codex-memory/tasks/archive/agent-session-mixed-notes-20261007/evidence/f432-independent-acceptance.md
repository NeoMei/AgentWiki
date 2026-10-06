# f4325942 独立验收

候选：`f4325942c53101e8c628cd68fc1b7f23f07ae5cd`。交接提交：`aff013bfd7507c3a0e2c2060bc607cc3f1fa28d3`，仅文档差异。显式工作树状态干净。所有 UI 操作在根代理自建隔离环境、真实候选构建、Chrome 自有标签执行；模型输出由外部确定性 CLI fixture 提供。

## 已完成结果

| 场景 | 实际证据 | 结果 |
| --- | --- | --- |
| A1 阅读批注和显式引用 | 原生选文建立两条笔记，加入待发送并显式添加跨文档指南；发送前 DB/HTTP session 与 turn 均为 0，发送后原始笔记仍待审 | 通过 |
| A2 多轮、跨文档与来源历史 | 同会话两轮提案、另一页追问；浏览器刷新后原始选文、批注、引用和发送时版本仍可查看；实际 worker 输入与 HTTP/DB 一致 | 通过（权限 UI 亦通过，见下） |
| A3 混合状态重生及人工交错 | 接受第一项→真实 Undo→人工尾段→读写切换→恢复草稿→Conflict→重生→仅接受第二项；两条笔记均已解决，正文精确匹配，人工尾段保留；追加第二个人工段再接受第一项 | 通过，关闭上轮 P2 |
| A4 逐次撤销与正式保存 | 三次原生 Undo、三次 Redo，每步完整复制正文逐字核对；接受期间正式 API/DB 原文不变；显式 Save 后主文逐字等于预期，副文与标题不变 | 通过；线性编辑历史，不是选择性撤销 |
| A5 长文与宽表格 | 实际 CSS 宽度 1600/1280/390；目录跳转、原生表格横滚、Agent 中文输入及关闭；390 抽屉切页与页面信息开关 | 通过；文档 scrollWidth 等于 viewport、scrollX=0 |
| A6 失败、停止、恢复 | 原生断网后发送：完整输入保留并提示重试；恢复网络；UI Stop 导致对应 fixture PID 收到 SIGTERM，结果为空、无迟到发布、active=0；刷新历史已恢复 | 通过（权限 UI 亦通过，见下） |

## 审查与运行层次

- 独立代码复审：`f432-fix-review.md`，未发现未关闭 finding。独立旧缺陷探针在冻结副本通过（1 passed/27 skipped），验证 resolved 历史项不篡改、未解决项转到新 task。该探针的正文恢复不是键盘 Undo；键盘结果见根 UI 回执。
- 真实 UI：`ui-f432-receipt.json`、各 DOM 与截图；两条明确已解决见 `ui-f432-mixed-result.txt`/`ui-f432-mixed-resolved.jpg`。
- 本地构建及服务：独立 git archive、自有 server/client/shared/protocol 构建与 schema/Redis/worker；详见 `runtime-f432/runtime-report.md`。构建不从研发会话的可变 dist 取服务。
- 当前新候选的独立撤权运行核验：`runtime-f432/auth-revocation-receipt.json`。另一个自有账号被移除权限后真实 fixture 子进程终止，结果不发布，session403/legacy null。
- 前候选 `1735f341` 的 13 项 HTTP/DB gate 未全部重跑。新候选 server dist 与之逐字同 hash；其中显式引用失效、无权 session 从列表排除等为继承的后端证据，不能称为新候选全量重跑。
- 真实 provider：未验。确定性 fixture 只证明产品链路，不证明真实模型质量、外部凭据或真实 provider 接入。
- ACP：本期只有接口契约，完整本机接入不在本期范围。
- 部署：未 push、merge、发布或部署；本地通过不能表述为线上已生效。
- 用户已明确不引入 CodeWiki；其他三项 OpenKnowledge 建议仍为研究结论，未扩展研发范围。

## 主要证据

- 发送前：`runtime-f432/ui-staged-before-send-receipt.json`
- 保存前后：`runtime-f432/page-checkpoint-pre-save.json`、`runtime-f432/page-checkpoint-post-save.json`
- 停止和历史：`runtime-f432/final-stop-history-receipt.json`、`runtime-f432/final-stop-page-receipt.json`
- 宽度与横滚：`ui-f432-responsive-receipt.json`、`ui-f432-layout-1600.jpg`、`ui-f432-layout-1280.jpg`、`ui-f432-layout-390.jpg`、`ui-f432-table-390.jpg`
- 请求失败：`ui-f432-failed-send.txt`

权限 UI 和自有资源清理均已通过。测试页图标使用本地 SVG 图片，渲染器显示 Image unavailable；不属于本次文档会话范围，未计作图片渲染验收。

## 权限失效 UI 最终核验

2026-10-06T18:23:47.997Z，仅在自有测试 schema 删除浏览器账号与自有 Space 的一条 membership，模拟授权丢失。账号为普通 user、无管理员绕过；账号、Space、4 篇页面内容与版本及其他权限不变。这是隔离故障注入，不是最后 owner 移除 API 的业务验收。

根在已加载历史的真实浏览器点击继续发送，看到“会话或来源已不可访问。请重试，或新建会话继续。”，原两轮提案及追问历史全部清除；输入保留。随后完整刷新，只显示“你没有权限执行此操作。请联系空间所有者或管理员确认成员角色后重试。”，正文与会话均不存在。证据为 `ui-f432-revoked-send.txt/.jpg`、`ui-f432-revoked-reload.txt`、`runtime-f432/ui-space-access-revocation-receipt.json`。

结论：A1–A6 已在上述版本与 fixture 边界内通过独立验收。真实 provider、完整 ACP、本机接入和部署仍不属于已通过结论。浏览器已退出测试账号、恢复网络与 viewport、关闭自有标签；本次运行时亦已清理完成。测试专用 origin 的本地笔记/偏好可能残留，不涉及其他账号或页面。

## 完成与停止跟进

最终清理回执 `runtime-f432/cleanup-receipt.json` 已读取核对：自有schema/服务/launchd/uploads/Redis/临时凭据移除，三个端口释放，五个fixture子进程均退出，受保护库存未变，冻结源码与构建hash仍一致。2026-10-06T18:26Z通过官方automation工具将agentwiki跟进设为PAUSED，文件回读确认；停止的是本期已完成验收跟进，不表示真实provider或完整ACP已验。验收证据已回传用户授权的研发聊天，产品代码无本聊天修改。
