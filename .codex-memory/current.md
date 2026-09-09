# 当前目标

- 实现已确认的 AgentWiki 目录与文章工作区（方案2），以及相关空间子页面的呈现衔接。

# 范围 / 不做

- 2026-09-09用户授权完成整合、版本整理、备份、发布、部署和公网验收。
- 不改变模型/权限/Agent绑定/协作审核/版本冲突/同步协议/目录修订与写入语义。
- 保留主目录其他并行任务与dirty子模块。

# 当前状态

- 隔离分支codex/reading-workspace-20260908；基线b776b830；Task1–7本地候选完成，功能代码a76b9971（含目录层级线）。
- 逐任务审查与最终限定复审通过；最终R1–R4及恢复回归R6均关闭，无剩余P2；R5位置缓存已修复并经独立限定复审关闭。
- 最终代码客户端101文件1395测试、lint/build、仓库typecheck均通过；构建保留既有大chunk提醒。
- 真实浏览覆盖目录分页/定位、浮窗、保存服务端回读、409、只读/撤销、历史/恢复、子页、局部错误/Retry、390px与双语。最终截图已保存并核对。
- 2026-09-09原生拖拽及移动后checkbox保存均通过浏览器操作与API回读，目录选中和面包屑正确。新删除回归由真实组件集成测试覆盖，最后浏览器删除确认已取消。
- 本地API53088/client5188/PG55438/Redis56388，仅合成数据；本次独立数据库reading_resume_20260909，旧reading_test保留；未合并/推送/发布。

# 稳定约束

- Folder只表达真实目录；Page承载正文，folderId为关系事实源，不解析path构造虚拟目录。
- 保存留在编辑；预览不保存；未保存保护覆盖所有导航和浏览器history。
- 当前蓝色AgentWiki视觉及原编辑器保持；本文目录右上角按需浮窗，不缩正文。
- 所有写入继续使用现有expectedTreeRevision/expectedUpdatedAt/删除影响和权限校验。
- 仓库原路径末尾有空格；隔离工作树下Git必须显式--work-tree，避免共享core.worktree指向主目录。

# 关键索引

- agentwiki/docs/verification/2026-09-08-source-production-alignment.md（已上线的图片和同步修正，发布必须保留）

- agentwiki/docs/verification/reading-workspace-acceptance.md（最终验收及截图）

- tasks/archive/reading-workspace/brief.md
- docs/superpowers/specs/2026-09-08-agentwiki-reading-workspace-design.md
- docs/superpowers/plans/2026-09-08-agentwiki-reading-workspace.md
- .superpowers/sdd/2026-09-08-agentwiki-reading-workspace/progress.md（逐任务精确续接）
- .superpowers/sdd/2026-09-08-agentwiki-reading-workspace/acceptance-notes.md（合成验收环境，不提交凭据）

# 风险 / 下一步

- 正在准备应用v0.10.0；合入origin/master cffe52aa，保留已上线图片解析与legacy同步修正。Local Sync0.9.1、protocol0.6.0、Obsidian0.4.0保持；生产SSH认证恢复等待用户完成控制连接。
- 外部Agent运行与当前页删除原生确认等剩余验证边界见验收报告；不能把这些算作已验证。
- 既有v0.9.1发布事实见agentwiki/docs/verification/space-name-v091-release.md，与本轮本地候选分开。
