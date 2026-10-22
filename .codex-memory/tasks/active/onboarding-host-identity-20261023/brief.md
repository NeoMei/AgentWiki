# 目标

用户指出通用授权提示词含 WorkBuddy 专用步骤导致连入名称混乱，要求修复。原任务仍是读取并逐项修复/回复 https://agentwiki.quukk.com/pages/f31ccf05-70d0-4376-95c3-f507a5bb1bce 。

# 状态

已随Web/API v0.12.57、npm Local Sync0.13.5精确版本及GitHub Release发布，源码192315ed。既有MCP连接已实际完成原Bug页读取和逐项回写，不再阻塞原报告。0.13.5真实客户端升级、重启后的MCP读取仍独立待验；npm latest推广因单独安全密钥超时待继续。

# 已实现

- generic 提示先识别实际宿主，显式选对应 client；WorkBuddy 私有缓存准备移至 `/api/onboard/runtime?client=workbuddy`，其他宿主无此代码。该 endpoint 仅准备 runtime，不启动新接入。
- 安装码提示明确绑定 Agent ID/Space ID；区分 client 配置类型与用户选择的 agentName。
- Codex 不再被假定热重载；preflight/install/attach 返回 reloadRequired=true。
- `onboard_status.gateway.connection` 返回实际运行连接 connectionId/agentId/client/serverUrl；顶层历史信息保持兼容，不输出凭据。
- generic 选择 WorkBuddy 时替换整个 npx 到固定包版本的前缀，避免重复包参数。

# 验证

- server 2 suites / 86 tests；frontend 2 files / 22 tests；local-sync onboarding 3 files / 40 tests；gateway 5 files / 67 tests。均完成红绿验证。
- server 与 local-sync typecheck；server/client/local-sync build；改动源文件 ESLint；diff-check、release guard 通过。client 保留 Mermaid circular/chunk-size warning。
- 独立复审发现 runner 替换问题，修复后无剩余阻断项。
- 本地 IAB 页面核对 generic/Codex/WorkBuddy 模板显示。复制按钮成功提示已出现，但浏览器 clipboard API 未读到该复制内容，不能将此当成完整剪贴板验收；组件测试已验证复制参数。
- 临时 Vite :5199 已停止，临时页面已关闭。

# 待完成

0.13.5客户端升级/重启后的真实MCP读页，尤其Windows/WorkBuddy，仍需独立验收。原Bug12项代码/逐项回写及Web生产发布已完成；新旧runtime固定runner、14公网指引和生产源码/健康通过，详见release-v01257-20261023及其发布回执。
