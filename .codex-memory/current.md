# 当前目标

完成通用 MCP / WorkBuddy 新接入的正式发布及真实宿主验收。用户已明确批准冻结候选 `0a299231667f03e68f6b97a0501c632602a75ae5` 发布 npm Local Sync 0.13.2、部署 Web/API 0.12.48，并继续验证真实浏览器授权、客户端权限、重启及 MCP 读页。授权持续有效，当前阻塞是认证，不需重复请求发布批准。

# 范围 / 不做

- 本轮发布 Web/API/client/root 0.12.48 和 Local Sync 0.13.2；protocol 保持 0.6.1，依赖、lockfile、数据库结构不变。
- 只发布冻结候选，后续回执文档提交不改变源码包；已发布 npm 0.13.1 不包含 generic/WorkBuddy 新流程。
- 保留原检出用户修改、日常 Vault、当前 Codex 0.13.0 配置及既有身份/Space 授权；不向对话索取密码、OTP 或密钥，不覆盖旧回执。
- 数据库回滚不是自动部署失败处理；必须保存故障现场并确认快照后用户写入的数据窗口，再单独决定恢复。

# 当前状态

- 修复提交 1812d6b1；测试浏览器泄漏修复 6fffd762；正式版本候选冻结为 0a299231。版本/构建/包门禁与独立审查通过，175 文件 tarball 与候选一致。
- 新 WorkBuddy 接入在生产 device/start 被 HTTP 400 阻断（生产仍只接受旧三类 client），未打开新授权页、未新增身份。WorkBuddy 5.8.3 已真实退出重启，新会话通过既有 0.13.1 连接调用 wiki_get_page 读取项目总览；这仅证明旧连接重启/读页，不代表新流程通过。
- 用户已批准本轮发布并继续真实验收。执行前检中 `npm whoami` 返回 E401；已启动 npm web login，真实 Chrome 安全密钥认证等待用户操作。
- SSH BatchMode 返回 Permission denied；预期 `/tmp/agentwiki-release-ssh/control` 不存在，本机 `~/.ssh` 仅有 config/known_hosts，无可用私钥。已请用户在自己的终端完成 SSH 登录并建立该 ControlPath，不获取或输出密码。
- 尚未执行 npm 发布、生产部署或远端写入。当前认证恢复后，沿已获授权继续执行，不再次请求同一发布许可。
- 最近正式基线为 Web/API 0.12.47、npm 0.13.1、Obsidian 0.5.12，发布/原页回执见 retest-20261017；原 Windows Vault 与黄金书屋 wrapper 边界保留。

# 稳定约束

- Git 单条命令显式 `--work-tree` 指向带尾空格工作树；测试清除 GIT_WORK_TREE/GIT_DIR，避免污染临时 git init。
- 单一 MCP 身份与动态 Space 授权不变；旧接入会话继续原精确版本命令，不改 version/planHash。
- 配置、网关检查、浏览器授权、宿主权限、重启和真实宿主读页分别记证；mock、curl、SDK 和旧连接成功均不替代新流程验收。
- 私有生产截图、正文、认证材料和备份不提交。既有发布授权持续有效；账户登录由用户完成，认证成功后继续已批准步骤。

# 关键索引

- .codex-memory/tasks/active/generic-mcp-onboarding-20261018/{brief,decisions,refs}.md
- agentwiki/docs/verification/generic-mcp-onboarding-20261018/{workbuddy-real-acceptance.md,release-candidate.json,release-candidate.md,release-execution-plan.md,browser-isolation-correction.md}
- /tmp/agentwiki-0132-release-candidate/neomei-agentwiki-local-sync-0.13.2.tgz
- /tmp/agentwiki-release-20261019-plan/：备份脚本副本、元数据差异、1357 文件源码清单。
- agentwiki/docs/verification/retest-20261017/{release.json,npm-release.json,plugin-release.json,acceptance.md}：最近正式基线与历史验收。

# 风险 / 下一步

1. 等待用户完成真实 npm 安全密钥认证和 SSH ControlPath 登录，分别只读验证 `npm whoami` 与控制连接；认证信息不进入对话或日志。
2. 复核冻结 tarball 摘要、npm 版本占用及生产基线；执行已批准的 npm 发布、官方逐字节/175 文件回读和空缓存安装。
3. 按执行计划完成协调备份，再从固定 0a299231 导出并部署 Web/API 0.12.48 与 LOCAL_SYNC_PACKAGE_VERSION=0.13.2，核对源码/服务/公网资源。
4. 继续真实 WorkBuddy 新浏览器授权、客户端权限、重启及新会话 MCP 读页；结果逐项记录，未通过前不宣称完整接入完成。
