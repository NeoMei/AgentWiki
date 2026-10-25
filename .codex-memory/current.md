# 当前目标

用户已授权再查、再修后发布。基线 ee955c72，追加审查与 v0.12.62 发布进行中。任务：tasks/active/agent-audit-release-20261026/brief.md。

# 范围 / 不做

覆盖会话状态、清空/历史/取消/引用 UI、REST 类型校验与来源权限、队列恢复、OpenCode 流解码及最终结果解析。保留现有写入授权和来源隔离。不修改原 Bug 汇总表，不操作其他生产用户会话；本轮未发布部署、未发送真实模型请求。

# 当前状态

- 修复 UTF-8 chunk 乱码、question/proposal 使用最终 step 判断、旧读取覆盖新状态、取消/失权后旧 poll 恢复内容、目录来源失效错误分类、单会话失效误清其他会话保存回执。
- 修复重试残留 progress/result、生产 DTO 隐式类型转换、切换会话残留错误、引用弹层 Tab 顺序和离开浏览器时关闭。
- 每项缺陷有失败复现与回归。第三轮交叉复查新增权限竞态并修复；修复后两位独立审阅者未再发现新的可复现重要问题。最终全仓8373通过/0失败/5既有条件跳过；build/typecheck/lint/diff检查均通过。
- 本地真实 React + 生产 CSS 中英文/1280px/390px验收通过；覆盖切换、历史、草稿、清空、Tab及模拟 composing Enter。网络层为合成 fixture，非真实模型或原业务数据验收。
- 线上仍为 v0.12.61，tag/Release/部署提交4075638e390d9f6c8174721761a4a232b7d014a3。清空图标已上线，旧会话保留。生产只读审计未见 .61 之后的新运行或卡住任务。

# 稳定约束

canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`，分支 `codex/agent-autochat-external-opencode`。编辑发布前运行 release guard；历史检出禁止发布。deploy.sh 打包工作树，应从冻结提交的干净 detached tree 部署。生产 `root@113.249.120.24:/root/agentwiki`，root 用户级 systemd、外部 OpenCode 2.1.1。中文“天枢”、英文“AgentWiki”，中国结 Logo。Local Sync 0.13.5 / protocol 0.6.1。保留未跟踪 design/。

# 关键索引

- tasks/archive/agent-audit-20261026/{brief,decisions,refs}.md
- agentwiki/apps/client/src/features/agent-session/
- agentwiki/apps/server/src/assist/
- agentwiki/docs/verification/agent-clear-context-20261026/{README,release-tools}.md
- agentwiki/docs/verification/agent-failure-20261026/README.md
- tasks/archive/agent-failure-20261026/{brief,decisions,refs}.md

# 风险 / 下一步

本轮修复已完成本地验收，尚未发布。当前通过的自动化与本地交互不证明真实模型内容完整正确，原 Bug 汇总表的语义核对仍独立；上次 .60 原案9来源执行及隔离保存证据可追溯。线上 .61 配套备份 `/var/backups/agentwiki/agent-clear-context-v01261.IrzEQtJp`，前应用树 `/root/agentwiki-previous-20261026055218`。免费备用模型认证、通知浏览器回验和 npm 认证仍为独立事项。
