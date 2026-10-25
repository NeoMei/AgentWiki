# 当前目标

为内置 Agent 加入“清空上下文”图标按钮，清除当前聊天显示和下一轮对话历史。

# 范围 / 不做

只改客户端面板、会话状态及行为测试。清空成功后替换当前标签为全新会话，输入、显式引用和批注归零；历史会话与其他标签保留。当前页面/目录仍作为来源。运行中须先停止。未新增后端删除接口，未改权限、页面内容、版本号或生产部署。

# 当前状态

- 新增双语 Eraser 图标，位于新建会话与历史按钮之间。创建失败保留原聊天与草稿，重复点击不重复创建；空白草稿清空后不复活旧批注。
- 异步创建完成后按用户焦点意图回到输入框；兼容 Chromium 禁用按钮自动失焦，后续点击、按键、外部聚焦或窗口失焦会取消回焦。
- 最终定向测试 AgentSessionPanel 98 + AgentSessionNotes 35 = 133 通过；客户端构建（含 TypeScript）、改动文件 ESLint、git diff --check 通过。此前完整客户端 169 文件 / 2827 项通过，之后新增的焦点/空态边界由最终定向测试验证。
- Chrome 155 本地真实组件交互已验收：清空、历史恢复、新会话发送、失败保留、运行禁用及延迟焦点；中英文桌面 1280px 与窄屏 390px 均用实际构建 CSS 验收，工具按钮与输入框无裁剪。浏览器覆盖 running；queued 由组件测试覆盖。测试使用隔离 API 数据，无生产操作。
- 生产仍为已正式发布的 v0.12.60，tag/运行源码 `99e66da0e72be583a9d1363760f17f2481a9d4ba`；此前 1436 文件、三服务、健康与公网检查通过。https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.60
- v0.12.60 内嵌 Agent 原失败用例 9/9 完整来源输入、只读执行与隔离真实保存已通过；原 Bug 汇总表仍未覆盖，语义完整性需要单独核对。旧 v0.12.61 提示候选已撤回。

# 稳定约束

canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`，分支 `codex/agent-autochat-external-opencode`。编辑发布前运行 release guard；历史检出禁止发布。生产 `root@113.249.120.24:/root/agentwiki`，root 用户级 systemd、外部 OpenCode 2.1.1。中文“天枢”、英文“AgentWiki”，中国结 Logo。Local Sync 0.13.5 / protocol 0.6.1。保留未跟踪 design/。

# 关键索引

- agentwiki/apps/client/src/features/agent-session/AgentSessionPanel.tsx
- agentwiki/apps/client/src/features/agent-session/useAgentSession.ts
- agentwiki/apps/client/src/features/agent-session/AgentSessionPanel.spec.tsx
- agentwiki/docs/verification/agent-failure-20261026/README.md
- tasks/archive/agent-failure-20261026/{brief,decisions,refs}.md

# 风险 / 下一步

清空按钮尚未发布，生产仍为 v0.12.60。新会话隔离旧 turns，保留当前页面/目录来源；成功运行不等于生成内容完整正确。正式发布须另冻结新候选与验证。已发布版本备份 `/var/backups/agentwiki/agent-failure-v01260.PcRiCrTx`，前应用树 `/root/agentwiki-previous-20261026044641`。免费备用模型认证、通知浏览器回验及 npm 认证仍为独立事项。
