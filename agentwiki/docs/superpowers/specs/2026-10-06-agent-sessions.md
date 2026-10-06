# Agent 会话侧栏第一阶段

## 授权与目标

用户在 OpenKnowledge ACP 交互调研后确认“继续推进”。本轮实现阅读/编辑共用的持久会话侧栏、跨文档连续问答、显式文档引用、发送私人笔记与修改候选审阅；同步固定未来本机 ACP 接入边界。沿用 codex/document-workspace 工作树，基线 ee9348839924fd7566ff3b67fa72beb6090a77ea。用户指定 p5c07ff 模型、独立任务审查和最终整合审查。

## 产品行为

- 阅读和编辑页均有 Agent 入口；Cmd/Ctrl+L 在文档工作区打开/聚焦侧栏。会话属于当前账号和 Space，切换文章/读写模式后仍保留；刷新可从服务器恢复历史，新建/切换会话。
- 对话逐轮展示用户消息、真实排队/执行/完成/取消/失败状态、回答和修改候选。运行中可停止；失败后可继续新一轮。输入内容不能在异步失败后丢失。
- 当前页面上下文可见；支持显式搜索添加同 Space 文档引用和移除引用。引用正文由服务器解析，不信任客户端冒充其他文档内容。
- 问答只读，允许具有页面阅读权限的人使用；生成修改候选要求现有编辑权限。编辑态使用发送瞬间的未保存 Markdown 草稿；阅读态使用当前保存版本。不会自动修改正式页面。
- 私人笔记仍在本机，只有明确发送的所选笔记内容/定位上下文进入会话。发送不等于解决；候选接受范围证明仍适用。
- 修改候选复用现有差异审阅。只在目标文章编辑页且身份、权限、saved version、当前草稿/选区锚点仍匹配时接受到草稿。正式 Save 独立。历史候选导航到对应文章，不向当前别的文章写入；重建候选时不得把本地 revision 数值误当持久版本。
- 桌面侧栏与正文协调占位；窄屏允许可关闭的侧层，输入、消息、按钮不横向溢出，不遮住关闭/文档工具栏。中文和英文文案齐全。

## 后端设计

新增 AssistSession，复用 AssistTask 作为会话轮次和既有租约队列，不建立第二个执行队列。每个 task 的 intent/result 是一组用户/助手消息。新会话任务具有 mode、clientRequestId、服务端 context、可恢复 progress；旧 AssistTask 行为兼容。

所有列表、历史、发送、执行、进度、结果发布、取消操作均检查 requester 和当前 Space 权限；上下文所涉及页面必须仍存在并属于该 Space。问答与 proposal 权限分别判断，跨账号/Space/撤销/删除失败关闭。会话中的引用不可通过旧任务 API 或 Socket 路径绕过校验。

发送幂等，同一会话最多一条 queued/running；并发请求用数据库事务/约束守护。引用最多 5 篇；输入、快照、历史和总上下文有明确上限，超过上限返回可展示错误，不静默丢弃用户选定文档。历史上下文取有界最近轮次，并在适配器输入中标明窗口。

取消须持久化且阻止后续发布，工作进程在短轮询内真正终止所属 CLI 子进程；超时/租约/权限丢失同样停止发布。无 provider 密钥时用独立测试 CLI 验证运行边界，不将 fixture 结果标成真实模型验收。

## API 契约

```ts
type AgentTurnMode = 'question' | 'proposal';
type AgentTurnStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
interface AgentSessionSummary { id: string; spaceId: string; title: string; createdAt: string; updatedAt: string }
interface AgentTurnRequest {
  clientRequestId: string; intent: string; mode: AgentTurnMode; pageId: string;
  snapshot?: {title: string; content: string; updatedAt?: string; draftRevision?: number; remoteRevision?: number; assistTarget?: unknown};
  referencePageIds?: string[]; noteIds?: string[];
}
interface AgentTurnView {
  id: string; sessionId: string; pageId: string | null; mode: AgentTurnMode;
  intent: string; status: AgentTurnStatus; createdAt: string;
  pageSnapshot: Record<string, unknown> | null;
  references: {pageId: string; title: string; updatedAt: string}[];
  noteIds: string[]; progressText: string; result: {summary?: string; changes?: string} | null;
  error: string | null;
}
interface AgentSessionDetail extends AgentSessionSummary { turns: AgentTurnView[] }
// POST /assist/sessions {spaceId, title?} -> AgentSessionSummary
// GET /assist/sessions?spaceId=... -> AgentSessionSummary[]
// GET /assist/sessions/:id -> AgentSessionDetail (bounded session; no hidden history truncation)
// POST /assist/sessions/:id/turns AgentTurnRequest -> AgentTurnView
// POST /assist/tasks/:id/cancel -> AgentTurnView
```

会话最多 100 轮，达到上限明确提示新建。列表返回最近 50 个会话。提示词最多取最近 10 个已结束轮次，累计文本限制 120000 UTF-16 字符；单次引用与快照总内容限制 100000，单个现有快照仍保持 50000 JSON 字符限制。服务端 DTO/测试锁定这些数值，前端展示对应错误。

## ACP 边界及明确不做

稳定 ACP v1 使用本机 connector 管理 stdio 子进程；网页会话和 AgentWiki MCP 工具权限独立。定义 provider capabilities、prompt/context、真实事件、cancel、future permission request 的边界，内置服务端 OpenCode provider 只声明本轮支持的能力。此次不安装/连接外部个人 Agent、不提供伪造 tool timeline、不宣传已完成 Follow Mode、多文档原子修改、图片/文件夹上下文、Agent slash commands、远程 ACP 或跨设备私人笔记。

## 约束和验收

- React/NestJS/Prisma 现有依赖，禁止增加 UI 框架/字体/新依赖；首屏 JS 550000 字节上限不变。会话 UI 和实现懒加载，原始 Markdown 单源、读写互斥。
- 保留 expectedUpdatedAt/treeRevision、Space/page/user 权限、现有 scoped candidate/私人笔记及外部 Agent 默认 deny-tools 约束。
- 后端测试覆盖同会话并发/重试、权限撤销/引用删除、问答不产候选、历史上下文、取消后无写入/实际进程终止；前端覆盖跨页/读写/账号隔离、慢请求串台、引用/笔记显式发送、候选拒绝/接受。
- 使用隔离数据库和 Redis、生产客户端构建、真实 API 与测试 CLI 做桌面/390px 浏览器验收；真实外部模型调用另行标记。新迁移必须先独立审查再更新已批准 migration digest gate。
- 不 push、merge、发布或部署。不修改原主目录。临时测试/截图/报告放 /tmp/agentwiki-sessions-20261006/。
