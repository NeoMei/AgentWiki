# 当前目标

- AgentWiki v0.10.0已发布；后续本地代码整理、客户端测试入口和前端包体积技术债处理完成，已完成验证并集成本地主分支。

# 范围 / 不做

- 用户已授权整合、发布、备份、部署及公网验收。
- 本次应用root/server/client0.10.0；Local Sync0.9.1、protocol0.6.0、Obsidian0.4.0保持，未发布npm。
- 后台模型、权限、目录修订、保存冲突、同步协议不变；保留master已上线图片/legacy同步修正。

# 当前状态

- 本轮基线为本地/GitHub master 9fc3fe5f；技术债分支codex/workspace-cleanup-tech-debt-20260909已集成本地master；本轮未推送、未另行发布或部署。
- 完整回归5454pass/3平台skip/0fail，DB181零skip；全仓build/lint/typecheck通过。整合及部署工具独立审查C0/I0/M0。
- 客户端测试入口自动构建shared/protocol，已验证旧产物和缺失dist场景；最终1423pass/0fail，lint/全仓typecheck/build通过，独立复审C0/I0/M0。
- 首屏静态JavaScript约927KB降至494.791KB；生产构建强制预算，完整Mermaid解析器690864字节仅保留懒加载的720KB受控例外。
- 本地生产构建完成编辑保存/checkbox回读、公式/代码高亮/5类图表、相关子页面与390px浏览器验收。
- 生产0.10.0，1326部署文件哈希一致；三服务active/running且NRestarts0，公网health全部ok，56迁移无pending/unresolved。
- 公网三层目录/层级线/浮窗跳转/编辑保存API回读/历史/来源返回/390px验证通过；合成用户空间已清理并DB复核。
- 成套备份/var/backups/agentwiki/space-name-v0100.ryGZVf；两份env与备份字节一致。

# 稳定约束

- Folder表达目录，Page承载正文；folderId为事实源。
- 预览不保存、保存留在编辑，离开保护/权限/写入校验保持。
- 本文目录右上角按需浮窗，目录层级细线。
- 本地路径末尾空格；Git必须显式--work-tree，保留他人工作及子模块。

# 关键索引

- agentwiki/docs/verification/workspace-cleanup-tech-debt-20260909.md
- agentwiki/docs/verification/reading-workspace-v0100-release.md
- agentwiki/docs/verification/reading-workspace-acceptance.md
- tasks/archive/reading-workspace/brief.md
- 私有证据/Users/neomei/.codex/recovery/agentwiki-v0100-release-20260909/

# 风险 / 下一步

- 不可变v0.10.0 tag与GitHub Release均已发布（tag5a4804e9）；生产已验收。
- 5个子模块4969个行尾差异已备份恢复；47个未跟踪文件全量备份，2个旧副本/临时文件归档，45份资料原位保留并本地忽略；主工作区已干净。备份/Users/neomei/.codex/recovery/agentwiki-code-cleanup-20260909/。
- 外部Agent模型流程、灾难恢复演练未在本次重跑；详见验收边界。
