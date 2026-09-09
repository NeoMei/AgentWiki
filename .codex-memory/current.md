# 当前目标

- AgentWiki目录与文章工作区v0.10.0已部署并完成公网验收，GitHub v0.10.0已发布。

# 范围 / 不做

- 用户已授权整合、发布、备份、部署及公网验收。
- 本次应用root/server/client0.10.0；Local Sync0.9.1、protocol0.6.0、Obsidian0.4.0保持，未发布npm。
- 后台模型、权限、目录修订、保存冲突、同步协议不变；保留master已上线图片/legacy同步修正。

# 当前状态

- 本地master和GitHubmaster已整合7442f458；功能源eeb3f73d，后续仅交付记录。
- 完整回归5454pass/3平台skip/0fail，DB181零skip；全仓build/lint/typecheck通过。整合及部署工具独立审查C0/I0/M0。
- 主仓重建旧shared/protocol产物后前端1417pass；源与完整测试候选一致。
- 生产0.10.0，1326部署文件哈希一致；三服务active/running且NRestarts0，公网health全部ok，56迁移无pending/unresolved。
- 公网三层目录/层级线/浮窗跳转/编辑保存API回读/历史/来源返回/390px验证通过；合成用户空间已清理并DB复核。
- 成套备份/var/backups/agentwiki/space-name-v0100.ryGZVf；两份env与备份字节一致。

# 稳定约束

- Folder表达目录，Page承载正文；folderId为事实源。
- 预览不保存、保存留在编辑，离开保护/权限/写入校验保持。
- 本文目录右上角按需浮窗，目录层级细线。
- 本地路径末尾空格；Git必须显式--work-tree，保留他人工作及子模块。

# 关键索引

- agentwiki/docs/verification/reading-workspace-v0100-release.md
- agentwiki/docs/verification/reading-workspace-acceptance.md
- tasks/archive/reading-workspace/brief.md
- 私有证据/Users/neomei/.codex/recovery/agentwiki-v0100-release-20260909/

# 风险 / 下一步

- 不可变v0.10.0 tag与GitHub Release均已发布（tag5a4804e9）；生产已验收。
- 原有49未跟踪文件/5dirty子模块均保留；冲突的原spec/plan存私有main-originals，主仓使用最终跟踪版本。
- 外部Agent模型流程、灾难恢复演练未在本次重跑；详见验收边界。
