# 当前目标

- 实现已确认的 AgentWiki 目录与文章工作区（方案2），以及相关空间子页面的呈现衔接。

# 范围 / 不做

- 仅当前隔离工作树本地前端候选；不合并、push、发布或部署。
- 不改变模型/权限/Agent绑定/协作审核/版本冲突/同步协议/目录修订与写入语义。
- 保留主目录其他并行任务与dirty子模块。

# 当前状态

- 隔离分支codex/reading-workspace-20260908；基线b776b830；Task1–7本地候选完成，最终代码9d66a123。
- 逐任务审查与最终限定复审通过；最终R1–R4及恢复回归R6均关闭，无剩余P2；R5位置缓存为明确延期P3。
- 最终代码客户端101文件1390测试、lint/build、仓库typecheck均通过；构建保留既有大chunk提醒。
- 真实浏览覆盖目录分页/定位、浮窗、保存服务端回读、409、只读/撤销、历史/恢复、子页、局部错误/Retry、390px与双语。最终截图已保存并核对。
- 原生拖拽最后复测未发出请求，因此浏览器移动未闭环；当前文章移动后面包屑/checkbox CAS由集成测试覆盖。新删除回归由真实组件集成测试覆盖，最后浏览器删除确认已取消。
- 本地API53088/client5188/PG55438/Redis56388，仅合成数据；未合并/推送/发布。

# 稳定约束

- Folder只表达真实目录；Page承载正文，folderId为关系事实源，不解析path构造虚拟目录。
- 保存留在编辑；预览不保存；未保存保护覆盖所有导航和浏览器history。
- 当前蓝色AgentWiki视觉及原编辑器保持；本文目录右上角按需浮窗，不缩正文。
- 所有写入继续使用现有expectedTreeRevision/expectedUpdatedAt/删除影响和权限校验。
- 仓库原路径末尾有空格；隔离工作树下Git必须显式--work-tree，避免共享core.worktree指向主目录。

# 关键索引

- agentwiki/docs/verification/reading-workspace-acceptance.md（最终验收及截图）

- tasks/archive/reading-workspace/brief.md
- docs/superpowers/specs/2026-09-08-agentwiki-reading-workspace-design.md
- docs/superpowers/plans/2026-09-08-agentwiki-reading-workspace.md
- .superpowers/sdd/2026-09-08-agentwiki-reading-workspace/progress.md（逐任务精确续接）
- .superpowers/sdd/2026-09-08-agentwiki-reading-workspace/acceptance-notes.md（合成验收环境，不提交凭据）

# 风险 / 下一步

- 本地候选供查看，分支与工作树保留。后续整合/发布另行处理。
- 原生拖拽浏览器验收、P3定位缓存、外部Agent运行边界见验收报告；不能把这些算作已验证。
- 既有v0.9.1发布事实见agentwiki/docs/verification/space-name-v091-release.md，与本轮本地候选分开。
