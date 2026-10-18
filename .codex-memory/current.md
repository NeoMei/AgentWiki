# 当前目标

完成通用 MCP / WorkBuddy 新接入的正式发布及真实宿主验收。用户已明确批准冻结候选 `0a299231667f03e68f6b97a0501c632602a75ae5` 发布 npm Local Sync 0.13.2、部署 Web/API 0.12.48，并继续验证真实浏览器授权、客户端权限、重启及 MCP 读页。授权持续有效；npm0.13.2正式可用及Web/API0.12.48生产部署已验证完成，当前继续真实新WorkBuddy接入验收，不重复发布或请求同一批准。

# 范围 / 不做

- 本轮发布 Web/API/client/root 0.12.48 和 Local Sync 0.13.2；protocol 保持 0.6.1，依赖、lockfile、数据库结构不变。
- 只发布冻结候选，后续回执文档提交不改变源码包；已发布 npm 0.13.1 不包含 generic/WorkBuddy 新流程。
- 保留原检出用户修改、日常 Vault、当前 Codex 0.13.0 配置及既有身份/Space 授权；不向对话索取密码、OTP 或密钥，不覆盖旧回执。
- 数据库回滚不是自动部署失败处理；必须保存故障现场并确认快照后用户写入的数据窗口，再单独决定恢复。

# 当前状态

- 修复提交 1812d6b1；测试浏览器泄漏修复 6fffd762；正式版本候选冻结为 0a299231。版本/构建/包门禁与独立审查通过，175 文件 tarball 与候选一致。
- 发布前新WorkBuddy接入曾在旧生产device/start被HTTP400阻断；旧WorkBuddy5.8.3连接已真实退出重启后通过0.13.1 MCP读到项目总览。两者是历史证据，不能代替本次新接入验收。
- npm第二次publish认证成功后经历HTTP202/Validating，现官方registry version/latest均0.13.2；官方tarball与冻结包字节一致，SHA256 836a92c65c9fae6ba3fbc181a6b861cbd4380517764291115b6ce45bc86556b9；175文件逐项匹配，空目录/空缓存安装0.13.2和protocol0.6.1通过。首次挑战超时E404作为历史保留。
- 固定0a299231部署脚本exit0；生产1357源码逐项匹配、Web/API/client0.12.48、Local Sync0.13.2、protocol0.6.1，Node24.18.0、3服务active、5healthok。公网HTML及5个入口资源与生产逐字节匹配；旧树/root/agentwiki-previous-20261019004923保留。
- 公开/api/onboard指令包含generic/WorkBuddy和固定0.13.2；真实Chrome接入指南已渲染通用默认、WorkBuddy、自动浏览器授权及客户端权限/重启提示。网页指南成功不是实际宿主完成证据。
- 协调备份/var/backups/agentwiki/generic-mcp-v01248.f0el29jz已verified/checksumsPassed/writersRestored；154永久blob匹配、writer暂停约7.114秒后恢复，备份后内外健康通过。未做恢复演练。
- 真实新WorkBuddy会话c3b10b4e-5a05-4f1b-9f8e-d9b9a0ada18f已由官方0.13.2已安装CLI自动打开真实Chrome授权页，用户授权仍pending、hostVerification未开始。原npx启动被宿主safe-delete拒绝操作缓存concurrency.lock，实际改为任务目录npm install后直跑CLI；不能称原始npx路径通过。后续权限、新配置、重启和新会话MCP读页未完成，newFlowAccepted仍false。

# 稳定约束

- Git 单条命令显式 `--work-tree` 指向带尾空格工作树；测试清除 GIT_WORK_TREE/GIT_DIR，避免污染临时 git init。
- 单一 MCP 身份与动态 Space 授权不变；旧接入会话继续原精确版本命令，不改 version/planHash。
- 配置、网关检查、浏览器授权、宿主权限、重启和真实宿主读页分别记证；mock、curl、SDK 和旧连接成功均不替代新流程验收。
- 私有生产截图、正文、认证材料和备份不提交。既有发布授权持续有效；账户登录由用户完成，认证成功后继续已批准步骤。

# 关键索引

- .codex-memory/tasks/active/generic-mcp-onboarding-20261018/{brief,decisions,refs}.md
- agentwiki/docs/verification/generic-mcp-onboarding-20261018/{workbuddy-real-acceptance.md,release-candidate.json,release-candidate.md,release-execution-plan.md,release-progress.json,release.json,browser-isolation-correction.md}
- /tmp/agentwiki-0132-release-candidate/neomei-agentwiki-local-sync-0.13.2.tgz
- /tmp/agentwiki-release-20261019-plan/：备份脚本副本、元数据差异、1357 文件源码清单。
- agentwiki/docs/verification/retest-20261017/{release.json,npm-release.json,plugin-release.json,acceptance.md}：最近正式基线与历史验收。

# 风险 / 下一步

1. 沿已有授权完成真实WorkBuddy新浏览器授权、客户端权限、新配置生效、完全重启和新会话MCP读页，逐项保存真实结果；本地模拟、公开指南和旧连接读页均不替代。
2. npm与生产发布已通过，不重复publish/deploy；后续若发现新问题，绑定具体版本和真实步骤再修复。
3. 保留协调备份、previous应用树、候选包与原始验收证据。备份后用户写入不属于旧快照，不自动恢复覆盖；不提交私有截图或认证材料。
