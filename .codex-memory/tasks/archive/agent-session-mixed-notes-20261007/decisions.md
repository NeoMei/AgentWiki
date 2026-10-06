# 决策

- 原有实现授权涵盖本功能正确性修复，无需再次要求授权。
- 先验证外部反馈与现有代码，组件probe日志的pass仅证明缺陷存在。
- Resolved继续保留历史状态；未解决笔记可独立迁移，但完整请求证明及错误身份/版本/原文拒绝不放宽。
- 恢复绑定仍验证完整事件上下文，只有eligible未解决项转绑；Resolved可保持更早轮次task。若需新增可选canonical annotations事件字段，仅服务现有session恢复，不改legacy语义或新增持久化。
- 本轮交付对象是修复并独立审查后的固定候选；外部真实UI由独立验收环境执行，组件probe与build不冒充浏览器通过。
- f4325942定向427检查/static/build和fresh独立spec/quality/integration review通过；只关闭代码修复gate。旧1735真实UI失败回执保留，新候选UI待验，任务保留active，未恢复整体完成宣称。

## 2026-10-07 验收归档

- 独立固定候选真实 UI 与组件探针已关闭原 P2，A1–A6 在 fixture 边界通过；本期范围可完成归档。
- 较晚 runtime cleanup 回执关闭原报告的清理待办，保留原件与时序，不改写历史证据。
- 仅归档，不追加实现或部署；CodeWiki 不引入，其他建议仍是研究。保留真实 provider、ACP、旧 HTTP gate、授权注入及浏览器存储边界。
