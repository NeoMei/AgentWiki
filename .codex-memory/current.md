# 当前目标

内嵌 Agent 目录访问及自动聊天修复已完成本地实现和验收，尚未推送或部署生产。

# 范围 / 不做

Agent 可遍历当前授权目录（含子目录），无需逐篇引用；聊天不再手动选择问答/修改模式，由提示词决定聊天回答、修改当前文章或当前目录新建。保留权限、版本、取消和草稿保护；本次没有更新生产、npm 或原反馈页。

# 当前状态

- 工作树 `/Users/neomei/.codex/worktrees/agent-directory-access/AgentWiki `（尾空格），分支 `codex/agent-directory-access`。目录访问提交 `519a7100`；自动聊天为其后续修复。
- 自动聊天最终验证：client 2727 通过；server 3503 通过、45 既有跳过；两端 typecheck、变更代码 lint、生产构建通过。首屏 JS 549985/550000 bytes，未放宽预算。
- 真实 PostgreSQL 11 项原子性/幂等/权限/取消/租约验证通过；真实模型 API 六场景与只读账号验证通过；生产前端构建 + 正常 Worker 入口的浏览器新建、更新和直接问答全部通过，数据库回读确认仅写入两次且问答未改正文。
- 独立整分支及格式重试复审完成，发现的问题均已修复并回归。模型无效 JSON 仅可在原时限内格式重试一次，仍严格验证动作、字段、目标和权限。
- 已发布 Web/API 0.12.51 的证据保留在既有 release 文档；此次未重新部署，发布前仍需核对线上源码基线。

# 稳定约束

Git 在对应工作树 cwd 下显式 --work-tree 指向带尾空格路径，不指定 common --git-dir。保留主检出用户改动。不要并行运行会清理同一 dist 的 build 与依赖 dist 的验证。发布必须以实时生产源码基线核对为准。

# 关键索引

- agentwiki/docs/verification/agent-directory-20261019/acceptance.md
- agentwiki/docs/superpowers/specs/2026-10-19-agent-auto-chat.md
- agentwiki/docs/verification/agent-auto-chat-20261019/acceptance.md
- agentwiki/docs/releases-v0.12.51.md

# 风险 / 下一步

如发布本分支，必须执行 Prisma 迁移 `20261019131500_assist_auto_mode`，随后验证线上真实 Agent 路径。当前结论仅覆盖本地隔离验收，不能视作生产已更新。
