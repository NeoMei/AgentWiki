# 当前目标

- 完成 Q3 人工报告20项的代码修复、独立审查与回测，用户已授权“那修吧”。

# 范围 / 不做

- 主应用与独立 Obsidian 插件在 `codex/q3-fixes-20260914` 隔离工作树修复；不发布、部署、改生产数据或安装日常 Vault。
- 原新3/4 Windows现场缺少实际版本和脱敏诊断，保留待原生复测；不删除控制文件或放宽完整性校验。

# 当前状态

- 实现及最终检查收口中，详见活跃任务和验证报告；主应用7条Chrome隔离流程通过，最终前端1503项通过，typecheck/lint通过。
- 历史发布基线仍为v0.11.2；应用0.11.2、Local Sync0.10.0、协议0.6.0、插件0.5.0，本轮不改版本。
- 主目录原有 `.codex-memory/current.md` 修改和未跟踪 `HANDOFF.md` 保持；所有产品修改在工作树中。
- 原目录记录：2026-09-10用户另行授权后NeoMei-Docs已更新并启用官方插件0.5.0，data.json保持、未触发同步。本轮未重新核验该历史记录，也未操作日常Vault。

# 稳定约束

- Folder为目录，Page承载正文；权限、候选基线、CAS与treeRevision必须保留。
- 模板版本不可变，不覆盖已有用户页面。原有7篇空页面补入指南仍待用户选择。
- 一凭证绑定一个Space Grant；完全重复正文只提示；自动合并保留删除语义，按服务器恢复为明确操作。
- 主仓路径末尾空格，Git显式 `--work-tree`；保留用户脏文件和其他工作树。
- 自动化、真实浏览器、Windows原生、发布、部署、安装为独立验收事实。

# 关键索引

- tasks/active/q3-regressions-20260914/brief.md
- agentwiki/docs/verification/q3-regression-repair-20260914.md
- docs/superpowers/plans/2026-09-14-q3-fixes.md
- 历史发布：agentwiki/docs/verification/template-guidance-v0112-release.md
- 当前私有证据：/Users/neomei/.codex/recovery/agentwiki-q3-20260914/

# 风险 / 下一步

- 完成搜索/查重与插件恢复保护独立复审、最终构建测试后本地提交；生产与日常安装另行处理。
- 受影响Windows原生同步、原Git生产运行、多空间使用中的实际凭证身份本轮没有现场复现；不要据便携测试宣称历史现场全部关闭。
