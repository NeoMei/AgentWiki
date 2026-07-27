<!-- codex-memory:template=spec-index:v2 -->

# 规则索引

本目录只放跨会话仍长期有效的规则，不放当日过程记录。

## 阅读顺序

1. 先读本文件
2. 前端任务优先读：
   - `design-rules.md`
   - `frontend-design-standards.md`
   - `frontend-page-workflow.md`
   - `component-reuse.md`
3. 再按任务需要读其他规则文件

## 规则文件

- `design-rules.md`
  - 前端规则入口与项目级补充约束
- `frontend-design-standards.md`
  - 默认视觉标准、组件标准、颜色与排版纪律
- `frontend-page-workflow.md`
  - 前端页面的固定执行顺序与自检流程
- `component-reuse.md`
  - 公共组件复用来源与复用边界
- `workflow-rules.md`
  - current / tasks / archive 的写法与更新原则
- `agentwiki-architecture.md`
  - AgentWiki 当前身份、权限、知识流水线、记忆、MCP 与旧入口边界

## 提升规则

满足任一条件时，应从 `current.md` 或任务文件中提升到 `spec/`：

- 同一条规则跨两次以上会话仍在使用
- 同一条规则在两个以上主题中重复出现
- 这条规则如果丢失，会导致后续明显返工
