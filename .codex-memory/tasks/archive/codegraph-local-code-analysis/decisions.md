# 决策

1. 默认使用确定性 `standard`，`deep` 仅由用户显式触发。
2. 采用 AgentWiki 内置 `CodeGraphProvider`，不增加独立 Provider 安装包。
3. CodeGraph 独立安装和升级；AgentWiki 只做能力协商，不按精确版本绑定。
4. 用户确认后允许源仓库维护 `.codegraph/`，但 AgentWiki 不读取内部表结构。
5. AgentWiki 生成并拥有 `agentwiki-code-snapshot@1`。
6. 基础分析确定性执行；深度分析模块优先，本地 Agent 仅在深度模式可选增强。
7. 完全移除 Codebase Memory，不保留自动或手动回退。
8. 标准路径采用两次独立确认：本地扫描计划哈希，以及最终 Preview 同步。
9. 只有完整、严格、可验证的 CodeGraph ownership marker 才允许缺席删除；无 marker 的历史页面必须保留并给出稳定不透明 warning。
10. 同一 source 的租约覆盖扫描、快照、分析、生成知识批量发布与 artifact 适配。
11. CodeGraph 内部存储、provider 和 mutable factory 不通过 npm package subpath 暴露；公共边界只返回脱敏且严格校验的 DTO。
12. 第二阶段不自动续跑，必须由用户以后单独要求。
