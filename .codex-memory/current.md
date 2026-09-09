# 当前目标

- AgentWiki v0.10.1已发布、部署并完成公网验收；代码整理与本轮技术债修复完成。

# 范围 / 不做

- 用户已授权修复、整合、发布、备份、部署与公网验收。
- 应用root/server/client0.10.1；Local Sync0.9.1、protocol0.6.0、Obsidian0.4.0保持，未发布npm。
- 后台模型、权限、目录修订、CAS保存、同步和数据库迁移不变。

# 当前状态

- 运行源码88a8fe4c已合并并推送master；v0.10.1不可变标签05f3de29，GitHub正式Release已发布，后续仅整理记录。
- 完整候选5463pass/3平台skip/0fail；DB181零skip；全仓build/lint/typecheck通过。主分支额外client1423pass、runtime非DB263pass/1skip、全仓build通过。独立审查C0/I0/M0。
- 测试入口自动构建shared/protocol；首屏JS约927KB降至494791字节；完整Mermaid解析器690864字节为720000字节上限的纯上游懒加载例外。
- 新版部署保留旧静态资源，1411候选文件与262旧资源校验一致；两份env与备份字节一致。三服务active/running、NRestarts0，公网health五项ok，56迁移无pending/unresolved。
- 新旧标签页实际编辑保存、checkbox API回读、公式/高亮/图表及390px目录/浮窗通过；旧编辑器请求200且非磁盘缓存。合成数据清理后DB复核。
- 成套备份/var/backups/agentwiki/frontend-v0101.5Tt8XN；前版应用/root/agentwiki-previous-20260909141339；恢复工具及操作说明使用一致v0101目录。

# 稳定约束

- Folder表达目录，Page承载正文；folderId为事实源。
- 预览不保存、保存留在编辑，离开保护/权限/写入校验保持。
- 本文目录右上角按需浮窗，目录层级细线。
- 本地路径末尾空格；Git必须显式--work-tree，保留他人工作及子模块。

# 关键索引

- agentwiki/docs/verification/frontend-v0101-release.md
- agentwiki/docs/verification/workspace-cleanup-tech-debt-20260909.md
- tasks/archive/release-v0101/brief.md
- agentwiki/docs/verification/reading-workspace-v0100-release.md
- 私有证据/Users/neomei/.codex/recovery/agentwiki-v0101-release-20260909/

# 风险 / 下一步

- 五个子模块4969个行尾差异已备份恢复。47个未跟踪文件全量备份：2个旧副本/临时文件归档，45份资料原位保留并本地忽略；备份/Users/neomei/.codex/recovery/agentwiki-code-cleanup-20260909/。
- 完整图表解析器的单块限制保留明确预算；不可为消除警告裁剪图表能力。旧静态资源保留用于已打开标签页，不能随新构建直接删除。
- 生产灾难恢复、Windows原生、全部Mermaid类型和外部Agent模型流程未在本次重新执行；详见验收边界。
