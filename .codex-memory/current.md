<!-- codex-memory:template=current:v1 -->

# 当前目标

- 对齐 AgentWiki 本地主仓、GitHub master 与已部署的图片同步配套修正；运行代码冻结于 287bcd803d52cf1153fe446fe4d681db58ed1652。

# 范围 / 不做

- 本轮整合既有提交并快进同步主分支，保留其他任务工作树、未提交文件和既有发布标签。
- 生产源码及编译文件已经与冻结候选一致，本轮无需生产写入、重启、迁移或重新发布 npm。

# 当前状态

- 原 GitHub master 975c1dd4、本地主仓 b776b830 均为冻结候选祖先；补入解析器与测试隔离 4 个提交，主分支包含本轮验证记录。
- 新运行 server harness：148 suites / 2570 tests 通过、1 Windows skip；前端 94 files / 1292 tests 通过；server build/typecheck/lint 与独立审查通过。
- 1032 个实际生产部署文件与候选 SHA-256 全部相同；238 个干净构建的服务端 JS 与生产 dist 全部相同。
- root user systemd 的 API/worker/frontend 均 active/running、NRestarts 0；内外网 health 五项均 ok。
- 服务端/客户端/Local Sync 仍为 0.9.1；protocol 0.6.0。独立 Obsidian 插件正式版 0.4.0 已发布，Mac NeoMei-Docs 已安装并确认加载。
- 主目录原有未跟踪文件与 submodule 修改保留；本轮 PostgreSQL/Redis 为独立测试实例，没有使用生产库。

# 稳定约束

- Folder只表达目录结构；只有Page可以绑定Agent或成为任务目标。
- PageAgentBinding不授予权限；活动Run冻结负责人；参与者仅来自本次启用任务并按Agent去重。
- 模板实例化Folder/Page/Binding/Run和一次tree revision全有或全无；外围任务提交后重试。
- 页面目标产物走Artifact+ChangeSet+一次人类审核；实时权限与版本冲突检查不得绕过，精确receipt重试保留。
- v3已发布ChangeSet禁止旧入口回滚；协作候选不可走普通入口绕过协作审核发布。
- AgentGrant.role是权限事实源；外部Agent人工审核后的恢复仍需用户明确唤醒。
- 空间名长度采用validator.js surrogate pair/variation selector规则，不使用HTML UTF-16 maxLength替代。
- 本地root/worktree末尾带空格，共享core.worktree会误导Git；每次显式--work-tree指定实际工作树。

# 关键索引

- 本轮记录：agentwiki/docs/verification/2026-09-08-source-production-alignment.md
- 本轮私有证据：/Users/neomei/.codex/recovery/agentwiki-source-align-20260908/
- 既有 v0.9.1 发布：agentwiki/docs/verification/space-name-v091-release.md
- 插件服务端部署证据：/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/docs/verification/2026-09-08-server-parser-deployment.md
- 插件 0.4.0 发布验收：/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/docs/verification/2026-09-08-release-040.md

# 风险 / 下一步

- 生产没有 Git 元数据，使用源码与编译产物哈希验证；GitHub master 的最新代码不等于旧的不可变 v0.9.1 tag。
- 本轮没有重新执行真实 Vault 写入或全套公网同步验收；生产没有代码变化，同一候选此前验收证据仍保留。
- 六个未部署仓库配置文件及首次测试库 vector 扩展预检失败已在验证记录中明确，不据此宣称所有仓库文件在服务器存在。
