# 当前目标

内置 Agent “清空上下文”图标按钮已上线并正式发布 v0.12.61，完成发布验收与交接。

# 范围 / 不做

清空成功后以全新会话替换当前标签，聊天、输入草稿、显式引用和待发批注归零；旧会话与其他标签保留，当前页面/目录仍作为来源。运行/排队/发送/创建/加载/取消时禁用；失败保留原上下文。未新增后端删除接口，未改权限或原 Bug 汇总表。

# 当前状态

- Eraser 图标位于新建会话与历史之间，提供中英文提示。处理空态旧草稿/批注回流和异步创建后的焦点意图，兼容 Chromium 禁用按钮失焦。
- 最终全客户端 169 文件 / 2830 项测试通过（面板 98、批注桥接 35）；TypeScript、改动 ESLint、生产构建及 diff 检查通过。Chrome 155 本地真实组件覆盖清空/历史/新会话发送/失败保留/运行禁用/延迟焦点；中英文 1280px、390px 使用实际 CSS 验收。queued 由组件测试覆盖。
- v0.12.61 生产、正式 tag 与 GitHub Release 均绑定 `4075638e390d9f6c8174721761a4a232b7d014a3`，功能提交 `0c0777f9`。1436 源文件逐项一致；三服务 active、五项健康 ok；公网 HTML 与 5 个入口资源匹配。
- https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.61 为非草稿、非预发布、latest，target 和 tag 均核对正确。
- v0.12.60 原失败用例的 9/9 来源输入、只读执行与隔离真实保存证据仍有效；原 Bug 汇总表未覆盖，语义完整性需独立核对。旧提示词 0.12.61 实验已撤回，本次新功能版本无该实验改动。

# 稳定约束

canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`，分支 `codex/agent-autochat-external-opencode`。编辑发布前运行 release guard；历史检出禁止发布。deploy.sh 打包工作树，应从冻结提交的干净 detached tree 部署。生产 `root@113.249.120.24:/root/agentwiki`，root 用户级 systemd、外部 OpenCode 2.1.1。中文“天枢”、英文“AgentWiki”，中国结 Logo。Local Sync 0.13.5 / protocol 0.6.1。保留未跟踪 design/。

# 关键索引

- agentwiki/apps/client/src/features/agent-session/{AgentSessionPanel.tsx,useAgentSession.ts,AgentSessionPanel.spec.tsx}
- agentwiki/docs/verification/agent-clear-context-20261026/README.md
- agentwiki/docs/verification/agent-clear-context-20261026/release-tools.md
- agentwiki/docs/verification/agent-failure-20261026/README.md
- tasks/archive/agent-failure-20261026/{brief,decisions,refs}.md

# 风险 / 下一步

生产浏览器已验收清空生成新会话、草稿归零、回焦、保留其他标签/历史、刷新持久性与当前页来源；全程未发送模型请求或写页面。新会话隔离旧 turns，当前页面/目录来源保留；成功运行不等于生成内容完整正确。v0.12.61 配套备份 `/var/backups/agentwiki/agent-clear-context-v01261.IrzEQtJp`，前应用树 `/root/agentwiki-previous-20261026055218`，恢复须匹配数据库/附件备份。免费备用模型认证、通知浏览器回验及 npm 认证仍为独立事项。
