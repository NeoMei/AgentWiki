# 当前目标

修复通用授权提示混入 WorkBuddy 专用步骤、宿主类型与 Agent 身份混淆；随后继续原 Bug 页逐项修复和回写。

# 范围 / 不做

本轮改前后端接入提示、按宿主读取运行环境准备、Codex 重载提示和当前网关身份诊断。不改生产权限，不重命名已有 Agent，不通过 SSH 绕过 MCP 读取 Bug 正文。

# 当前状态

- 锁定工作树 `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`；分支 `codex/agent-autochat-external-opencode`，HEAD `cec79c4e`，v0.12.56 守卫通过。
- 提示词与网关修复已在工作树中完成、未提交/发布；215 项定向测试通过，server/local-sync typecheck、三端 build、改动文件 lint 和独立复审通过。前端构建保留 Mermaid 分包/体积 warning。
- SSH 只读确认：`项目管理` Space 为 `cmtmgsk5b00neuo709n0x7nqj`，原 Bug 页面属于它。`codex` Agent `cmufeiyw2035s12csmaji1t0v` 已有 editor 权限。
- 当前 Codex 进程仍用旧连接 `361074ee-0825-4aee-88c1-ca20b56b42de`（0.13.1），绑定 `workbuddy` Agent `cmvdy1dqa0ethbu4s9elst5n9`，它仅有「AgentWiki 项目」权限。不是新授权未生效。
- 磁盘 `/Users/neomei/.codex/config.toml` 已正确绑定 0.13.4 / 新连接 `60b8235e-f6a0-5b42-ac68-3b225d844fc4` / codex Agent。需客户端重载或完整重启新会话后再真实 MCP 验证。
- 原先扫描/Session 修复已部署的证据保存在本任务 refs 与上一份 current 归档；本轮未部署新代码。

# 稳定约束

编辑/发布前运行 `cd agentwiki && node scripts/agentwiki-release-guard.mjs`。生产目标固定 `root@113.249.120.24:/root/agentwiki`，不得使用 deploy 默认目标或历史 checkout。Space 授权实时查询；不为绕过拒绝换身份/密钥或用 DB 读写正文。

# 关键索引

- `tasks/active/onboarding-host-identity-20261023/brief.md`
- `tasks/active/onboarding-host-identity-20261023/decisions.md`
- `tasks/active/onboarding-host-identity-20261023/refs.md`
- `agentwiki/AGENTWIKI_RELEASE_CANDIDATE`

# 风险 / 下一步

先重启当前客户端并在新会话用真实 `wiki_list_spaces` / `wiki_get_page` 读取原 Bug 页 `f31ccf05-70d0-4376-95c3-f507a5bb1bce`。原页正文尚未读到，不能宣称已修复或回写。发布本轮接入修复需要新的 local-sync npm 版本及前后端版本常量同步；npm 0.13.4 不包含新诊断字段，不能只部署服务端就宣称全部生效。
