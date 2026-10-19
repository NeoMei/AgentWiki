# 当前目标

内嵌 Agent 目录访问与自动聊天已实现、发布并完成生产验收。Web/API/client 当前发布版本为 0.12.52。

# 范围 / 不做

Agent 可遍历当前授权目录及子目录，无需逐篇引用；聊天按提示词回答、修改当前文章或在当前目录创建文章，不需要选择模式。Local Sync 保持 0.13.4，protocol 保持 0.6.1；本次未发布 npm 或修改原反馈页。

# 当前状态

- 工作树 `/Users/neomei/.codex/worktrees/agent-directory-access/AgentWiki `（尾空格），分支 `codex/agent-directory-access`。版本标签 v0.12.52 和冻结源码 `05373af7816851706a259b8a99daabee99042af7` 已推送；线上已部署该提交。
- 全量 8080 通过、6 既有跳过；真实数据库 239 项无跳过。构建、typecheck、lint 通过；首屏 JS 549985/550000 字节。
- 1377 生产源码文件、公网 HTML 与五项入口资源匹配；64 项迁移无 pending；API/Worker/Frontend active，NRestarts=0，五项健康 ok。
- 真实模型 API 四场景与浏览器目录总结、新建、修改三场景通过。文档保存精确回读，纯聊天未修改正文。临时验收账号/Space 已官方 API 软删除，浏览器页关闭。
- 协调备份 `/var/backups/agentwiki/auto-chat-v01252.rsx23ym7` 校验通过，写入暂停 7.613673 秒；旧应用保留 `/root/agentwiki-previous-20261019220622`。未执行恢复演练。

# 稳定约束

Git 在对应工作树 cwd 下显式 --work-tree 指向带尾空格路径，不指定 common --git-dir。保留主检出用户改动。不要并行运行会清理同一 dist 的 build 与依赖 dist 的验证。发布以实时生产源码核对为准。

# 关键索引

- agentwiki/docs/releases-v0.12.52.md
- agentwiki/docs/verification/agent-auto-release-20261019/acceptance.md
- agentwiki/docs/verification/agent-auto-release-20261019/release.json
- agentwiki/docs/verification/agent-directory-20261019/acceptance.md
- agentwiki/docs/verification/agent-auto-chat-20261019/acceptance.md

# 风险 / 下一步

当前无未完成发布事项。新 auto/目录会话不兼容旧版服务校验，优先前向修复；不能只切旧应用视为完整回滚。配对恢复需处理备份之后的用户写入。
