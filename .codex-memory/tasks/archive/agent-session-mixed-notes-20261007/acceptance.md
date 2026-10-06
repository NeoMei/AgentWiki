# 本期独立验收归档 — 已通过

归档日期：2026-10-07（Asia/Shanghai）。固定产品候选 `f4325942c53101e8c628cd68fc1b7f23f07ae5cd`；验收交接 `aff013bfd7507c3a0e2c2060bc607cc3f1fa28d3` 仅文档，验收时显式 work-tree 干净。本次只归档已取得的证据，不追加实现、测试运行或部署。

## 验收结论

- 原混合状态 P2 已由独立组件探针和独立根代理真实 Chrome 操作共同关闭：接受第一项 → 真实 Undo → 人工尾段 → 路由恢复草稿 → Conflict/Regenerate → 只接受第二项，两条笔记均 Resolved，正文逐字符合预期，人工尾段保留。
- 人工修改与两份候选交错后，3 次真实 Undo、3 次 Redo 每步正文逐字通过。接受只改变草稿；正式页在显式 Save 前不变，Save 后 API/DB 主文精确等于预期，副文和标题不变。这是标准线性历史，不是选择性撤销；Undo 不回退历史接受/笔记状态。
- 两条阅读批注及引用显式发送、跨页多轮、reload 历史来源及发送时版本通过；断网失败保留输入；Stop 终止真实 fixture 进程，无迟到结果发布。
- 1600/1280/390 实际 CSS 宽度的长文、宽表横滚、目录和 Agent 面板实操通过，未出现整页横向溢出。
- 自有测试账号在单一 Space membership 被隔离移除后，原 token 正文/session 均 403；真实 UI 继续 Send 清空历史并提示失权，reload 无正文和会话。此为隔离授权丢失注入，不是最后 owner 移除业务 API 的验收。
- 独立规范/质量/集成复审通过；研发定向 12 文件 427 项、类型检查、ESLint、构建通过。新独立组件探针 1 passed/27 skipped。组件正文恢复不冒充真实键盘 Undo，浏览器结论来自单独 UI 回执。

## 清理与证据时序

原始验收报告和 UI JSON 写于运行时清理完成前，其中“清理进行中/remaining cleanup”保留为当时状态。较新的 `evidence/runtime-f432/cleanup-receipt.json` 和 runtime report 已将该项关闭：2026-10-07 02:26:09（Asia/Shanghai，原 UTC 回执 2026-10-06T18:26:09.171Z）独立最终核验确认自有 schema、进程/fixture、launchd、uploads、Redis 数据和凭据文件均移除，51913/51914/53467 端口释放，受保护 inventory 不变。

浏览器已退出测试账号、恢复网络/视口并关闭自有标签。测试专用 origin 可能残留本地笔记/偏好；未宣称清除浏览器全部存储。本研发会话只读核对上述回执，未操作独立运行时。

## 必须保留的边界

- 真实 provider 未验：使用外部确定性 CLI fixture；不证明模型质量、真实凭据或 provider 接入。
- ACP 仅接口/能力契约，完整本机 connector、tools、permissions、FollowMode 不在本期交付。
- 旧 `1735f341` 的 13 项 HTTP/DB gate 未在新候选全量重跑；新旧 server dist 逐字同 hash。旧后端回执与本候选新 UI/API/DB/停止/撤权核验分开记录，不能称为新候选全量重跑。
- 测试页本地 SVG 图标显示 Image unavailable，未计作图片渲染验收。
- CodeWiki 明确不引入；其他 OpenKnowledge 建议仍限研究，未授权扩展研发。
- 未 push、merge、release 或 deploy；本地验收通过不表示线上生效。分支和工作树保留，本期归档后停止自动跟进，不新增任务或自动化。

## 证据索引

- [原始独立验收报告](evidence/f432-independent-acceptance.md)
- [真实 UI 结构化回执](evidence/ui-f432-receipt.json)
- [独立修复复审及探针](evidence/f432-fix-review.md)
- [独立版本构建和 API/DB/进程记录](evidence/runtime-f432/runtime-report.md)
- [最终清理回执](evidence/runtime-f432/cleanup-receipt.json)
- [归档副本来源与 SHA-256](evidence/manifest.json)
- [本期最终状态](acceptance-result.json)

以上五份证据按原字节复制，未改写独立报告。截图、DOM、更多 API/DB 检查及原始清单仍在 `/tmp/agentwiki-independent-acceptance-20261006.4eB3KG/`，其中 `ui-f432-mixed-resolved.jpg` 记录两项已解决；未复制凭据或重新运行外部环境。`candidate-handoff.json` 保留交接时 UI 待验状态，现已由本文件与 acceptance-result.json 取代。
