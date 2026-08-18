# 决策

1. 采用两种产品模式：默认 `standard` 与用户显式触发的 `deep`。
2. 采用 AgentWiki 内置 `CodeGraphProvider`，不增加独立 Provider 安装包。
3. CodeGraph 独立安装和升级；AgentWiki 只做能力协商，不按精确版本绑定。
4. 允许用户确认后在源仓库维护 `.codegraph/`。
5. AgentWiki 生成并拥有 `agentwiki-code-snapshot@1`，Analyzer 不读取 CodeGraph 内部表结构。
6. 允许一次性重建 CodeGraph 派生页面，不保留 Codebase Memory 页面 ID。
7. 深度分析采用模块优先，不生成逐符号 Wiki 页面。
8. 基础分析确定性执行；本地 Agent 仅在深度模式做可选增强。
9. 标准扫描不删除未执行的深度分析层；过期深度结果标记 stale，等待显式刷新或删除。
10. 完全移除 Codebase Memory，不保留自动或手动回退。
11. 实施拆成两份独立计划；第一阶段完成标准扫描、迁移和旧扫描器移除，第二阶段不自动续跑。
12. 深度模式由当前本地 Agent 通过 Gateway 的有界工作项和结构化回填协议完成解释增强；Local Sync 不内置模型调用。
