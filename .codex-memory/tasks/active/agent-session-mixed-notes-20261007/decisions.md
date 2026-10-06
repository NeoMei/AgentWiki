# 决策

- 原有实现授权涵盖本功能正确性修复，无需再次要求授权。
- 先验证外部反馈与现有代码，组件probe日志的pass仅证明缺陷存在。
- Resolved继续保留历史状态；未解决笔记可独立迁移，但完整请求证明及错误身份/版本/原文拒绝不放宽。
- 恢复绑定仍验证完整事件上下文，只有eligible未解决项转绑；Resolved可保持更早轮次task。若需新增可选canonical annotations事件字段，仅服务现有session恢复，不改legacy语义或新增持久化。
- 本轮交付对象是修复并独立审查后的固定候选；外部真实UI由独立验收环境执行，组件probe与build不冒充浏览器通过。
- f4325942定向427检查/static/build和fresh独立spec/quality/integration review通过；只关闭代码修复gate。旧1735真实UI失败回执保留，新候选UI待验，任务保留active，未恢复整体完成宣称。
