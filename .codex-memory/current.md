# 当前目标

模板内容预览与自定义模板管理/使用入口两项反馈已完成独立候选、验证与审查，并于 2026-10-20 部署 v0.12.54；真实生产浏览器11项及精确清理通过。

# 范围 / 不做

只修复新建内容与模板管理的客户端流程，不更改服务端权限、数据库模型、既有模板版本或用户内容。用户已授权发布；Web/API/client 0.12.54，Local Sync 0.13.4 / protocol 0.6.1 不变，不发布 npm。

# 当前状态

- 工作树 `/Users/neomei/.codex/worktrees/template-preview-custom/AgentWiki `（尾空格），分支 `codex/template-preview-custom`，基线 f13c5f0a。
- 预览显示真实正文缩略图、页面组切页和放大只读内容，处理错误/空内容/旧响应/版本漂移。
- 新建页左侧自定义模板，管理员顶部管理入口；管理页从页面创建和直接使用，保留folder目的地及编辑/版本/归档/恢复。
- 生产构建通过；首屏JS 547823/550000字节。客户端2756项、浏览器5条、ESLint及独立复审通过。回执见关键索引。
- 冻结发布提交 e067fa3728b68db844d39e60f049801937f3cc96。分阶段完整回归 8109 passed / 6 既有 skipped，数据库239零跳过；高并发客户端1条等待超时，单worker全2756通过，源码与断言未改。
- 配套备份 /var/backups/agentwiki/templates-v01254.mexgfxtm 校验通过；生产1389文件、入口5资源及健康通过，64迁移无待办，配置字节保持。

# 稳定约束

Git 在对应工作树 cwd 下显式 --work-tree 指向带尾空格路径，不指定 common --git-dir。保留主检出用户改动。不要并行运行会清理同一 dist 的 build 与依赖 dist 的验证。发布以实时生产源码核对为准。

# 关键索引

- .codex-memory/tasks/archive/template-preview-custom-20261019/{brief,decisions,refs}.md
- agentwiki/docs/verification/template-preview-custom-20261019/acceptance.md
- agentwiki/docs/verification/template-preview-custom-20261019/README.md
- agentwiki/docs/releases-v0.12.54.md
- agentwiki/docs/verification/template-preview-custom-20261019/production/

# 风险 / 下一步

两项反馈已完成生产验收；GitHub v0.12.54正式发布，标签固定e067fa37，发布/清理回执已归档。原项目账号为editor，管理入口依既有权限隐藏，owner/admin可管理；未改变业务数据或成员权限。
