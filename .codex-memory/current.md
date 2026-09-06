<!-- codex-memory:template=current:v1 -->

# 当前目标

- v0.9.1空间名称修复已发布、部署并通过公网验收；本轮发布工作完成。

# 范围 / 不做

- 已完成源码合并/push、npm、GitHub Release、生产备份部署和真实API/浏览器验收。
- 保留原隔离工作树和用户其他未提交文件，不修改其他并行任务；未重复外部模型执行或灾备恢复演练。

# 当前状态

- 发布源码/tag v0.9.1目标072a93c0，功能准备8784acd2、README修正6dc3fb4b。master已快进并push，后续仅提交发布记录。
- 应用/server/client/LocalSync0.9.1；protocol0.6.0不变。服务端兼容0.9.0和0.9.1，签发/交换/replay保持实际请求版本。
- 新建/改名trim后1–32个validator.js单位，不截断。旧长名保存其他设置不带name；Agent原始确认计划hash和原始回执/replay不变，落库名称trim。
- 本地完整分阶段回归5277通过/3skip；类型/lint/build、公开包全新安装和最终源码/运维审查通过。
- 生产root@113.249.120.24:/root/agentwiki为0.9.1；55个成功迁移、无pending；1032部署输入文件哈希匹配。三个服务active/NRestarts0，public health全部ok。
- 双env只变LOCAL_SYNC_PACKAGE_VERSION；既有白名单cmt024s4808nm3gmnko5v9gj5和其他配置保留。
- 真实公网Chrome390x844/1440x900、中英文、32/33字符、旧69字符名称、设置/改名持久化、两版本onboarding/raw replay均通过；API smoke32通过。4Agent/4Space/1User测试资源已清理，DB只读核验活跃记录0，测试凭据销毁。

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

- 发布记录：agentwiki/docs/verification/space-name-v091-release.md
- GitHub Release：https://github.com/NeoMei/AgentWiki/releases/tag/v0.9.1
- 持久私有证据：/Users/neomei/.codex/recovery/agentwiki-v091-release-20260906/
- 生产备份：/var/backups/agentwiki/space-name-v091.qj7XtW；恢复工具：/root/agentwiki-release-tools-v091/；原应用：/root/agentwiki-previous-20260906205927。
- 原任务01a06f37-1d32-7231-9e99-a9c0a1c6312a，工作树/Users/neomei/.codex/worktrees/69d8/AgentWiki （末尾空格）；目录兼容链接和恢复备份保留。

# 风险 / 下一步

- 当前发布范围无未解决阻塞。旧0.9.0客户端仍受支持；备份不授权丢弃备份后的生产写入。
- 失败尝试与修正记录均保留：首轮回归漏PG_DUMP_BIN、npm认证/传播延迟和验收脚本元数据/DB字段修正，不将失败尝试算作成功。
- 主目录其他文件及5个submodule状态已保持；专用测试库PG50415/Redis50416最终无测试遗留。
