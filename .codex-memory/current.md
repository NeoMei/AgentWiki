# 当前目标

- 同一个 Agent 的单个 Local Sync 网关支持多个 Space，并完成正式发布、生产部署和公网验收。

# 范围 / 不做

- 实施、独立审查、包发布、GitHub 合并和生产部署已获用户授权。
- 保持 Space 独立 Credential/Grant、显式 spaceId 路由；未知或冲突选择器拒绝回落。

# 当前状态

- AgentWiki 0.12.12 与 Local Sync 0.11.0 已正式发布；协议继续为 0.6.1。GitHub 标签提交 e2f68985d730647bd8c1444a1b1f3517715ba401 与部署来源 6163655047956868426ab946803bd06e43e0a200 的应用树一致。
- 完整回归 5952 通过 / 0 失败 / 6 既有或平台 skip；类型检查、lint（0 error / 3 既有 warning）、构建通过；独立复审没有未关闭问题。
- 生产 1436 源文件哈希一致，Assist 保留；迁移字节不变、未执行迁移；api/worker/frontend 用户级 systemd active，公网默认 TLS 健康五项 ok；接入文档固定 0.11.0。
- 公开 npm 空目录安装后，实际单 stdio gateway 公网验证同 Agent 双 Space、并发读取、每个 Space 提案/审批/发布/MCP 回读、错误 selector 拒绝、撤销 A 后 B 可读；全部测试 fixture、凭据/JWT、网关和临时安装目录已清理。
- 旧 0.10.2 配置和 0.9.1 安装协议与多 Space 共存验收通过。

# 稳定约束

- 路径末尾空格；Git 使用显式 work-tree，勿改 core.worktree。
- 不以完整 tag 覆盖生产未收录的 Assist 修复；Space 授权不合并为跨空间密钥。
- 本地测试、正式发布、部署和公网验收分别记录，计划不作为完成证据。

# 关键索引

- agentwiki/docs/releases-v0.12.12.md
- agentwiki/docs/verification/multi-space-v01212/release-receipt.json
- agentwiki/docs/verification/multi-space-v01212/public-multispace-evidence.json
- https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.12
- 上一轮 Q2 0.12.11 / 原生 GUI v2/v3 历史证据：agentwiki/docs/verification/q2-boundary-evidence-20261002；任务 brief 保留在 .codex-memory/tasks/active/q2-defect-closure-20261001/brief.md。

# 风险 / 下一步

- 本次没有新增原生 GUI onboarding 验收，Windows 原生 Obsidian GUI 仍未覆盖。
- 生产配对备份 /var/backups/agentwiki/q2-v01212-20261003225326 已核验，旧应用 /root/agentwiki-previous-q2-20261003225326 保留。
- 公网多 Space 发布验收已完成，没有本次发布的未关闭门槛。
