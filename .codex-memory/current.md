# 当前目标

内嵌 Agent 目录访问、自动聊天及“修改范围”下拉框样式修复均已上线。Web/API/client 当前发布版本为 0.12.53。

# 范围 / 不做

Agent 可遍历当前授权目录及子目录，无需逐篇引用；聊天按提示词回答、修改当前文章或在当前目录创建文章，不需要选择模式。0.12.53 仅优化下拉箭头、间距和聚焦边框，保留原生键盘与辅助功能行为。Local Sync 保持 0.13.4，protocol 保持 0.6.1；未发布 npm 或修改原反馈页。

# 当前状态

- 工作树 `/Users/neomei/.codex/worktrees/agent-directory-access/AgentWiki `（尾空格），分支 `codex/agent-directory-access`。版本标签 v0.12.53 和冻结源码 `476408cb4e59cf4cc078ea35010f68b47c6ecd7f` 已推送并部署，GitHub Release 已发布。
- 0.12.53 的 116 项相关测试、客户端生产构建与改动 TSX 的 ESLint 通过；首屏 JS 549985/550000 字节。桌面与窄面板、箭头点击、方向键和 Esc 已验证；生产浏览器确认新样式，无 warning/error。
- 1377 生产源码文件、公网 HTML 与五项入口资源匹配；64 项迁移无 pending；API/Worker/Frontend active，五项健康 ok。0.12.53 无新迁移、依赖或锁文件变更。
- 0.12.52 已完成全量 8080 通过、6 既有跳过、真实数据库 239 项无跳过，以及真实模型 API 四场景与浏览器目录总结、新建、修改三场景验收；0.12.53 未重复运行该全量验收。
- 0.12.53 临时验收账号/Space 已官方 API 软删除并回读确认，令牌失效，临时浏览器页和本地预览已关闭。
- 配对备份 `/var/backups/agentwiki/scope-ui-v01253.x49anmnl` 校验通过，旧应用保留 `/root/agentwiki-previous-20261019225209`。未执行恢复演练。

# 稳定约束

Git 在对应工作树 cwd 下显式 --work-tree 指向带尾空格路径，不指定 common --git-dir。保留主检出用户改动。不要并行运行会清理同一 dist 的 build 与依赖 dist 的验证。发布以实时生产源码核对为准。

# 关键索引

- agentwiki/docs/releases-v0.12.53.md
- 本次私有验收回执 `/private/tmp/agentwiki-scope-release-20261019/release-receipt.json`
- agentwiki/docs/releases-v0.12.52.md
- agentwiki/docs/verification/agent-auto-release-20261019/acceptance.md
- agentwiki/docs/verification/agent-auto-release-20261019/release.json
- agentwiki/docs/verification/agent-directory-20261019/acceptance.md
- agentwiki/docs/verification/agent-auto-chat-20261019/acceptance.md

# 风险 / 下一步

当前无未完成发布事项。新 auto/目录会话不兼容旧版服务校验，优先前向修复；不能只切旧应用视为完整回滚。配对恢复需处理备份之后的用户写入。
