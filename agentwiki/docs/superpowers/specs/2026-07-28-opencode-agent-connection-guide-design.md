# OpenCode 接入 AgentWiki 使用指南设计

## 目标

补全使用指南中从生成 Agent 凭据到本地 Agent 实际接入成功的完整路径。教程必须使用真实 AgentWiki 和真实 OpenCode 操作截图，不使用模拟界面。成功演示以 OpenCode 向 AgentWiki 实际发布一个页面为主结果，并以服务端活动记录作为审计证据。

## 范围

- 重排“如何接入 Agent”为六个连续步骤。
- 使用临时 Agent 凭据完成一次真实 OpenCode 接入。
- 展示 OpenCode 成功结果、AgentWiki 已发布页面和 MCP 活动记录。
- 所有新增文案同时提供简体中文和英文。
- 截图保持原始宽高比，只裁切与当前步骤有关的区域。

本次不新增 AgentWiki 协议、权限模型或 OpenCode 专用服务端接口，也不改变现有 MCP 认证方式。

## 教程流程

1. 创建 Agent。
2. 授予目标 Space 访问权限。
3. 配置该 Space 下的权限范围。
4. 创建凭据：生成一次性 Key，同时显示可复制的“一键接入指令”。
5. 打开本地 OpenCode，将整段接入指令作为一条消息粘贴给它，并要求它在演示 Space 中发布一个指定标题和正文的页面。OpenCode 根据指令配置 MCP、完成 initialize、调用 `list_spaces` 获取内部 Space ID，再调用 `propose_page` 发布页面。
6. 用三份真实结果确认接入成功：
   - OpenCode 明确返回“已接入 AgentWiki（Agent 名称）”，并报告页面发布成功及页面标题。
   - AgentWiki 页面列表或详情中出现该页面，并显示 Agent 创建及自动发布来源。
   - AgentWiki 活动记录出现同一次操作的成功 MCP 调用，至少包含 `list_spaces` 和 `propose_page`。

## 页面结构

现有步骤卡片沿用同一视觉语言和 `GuideScreenshot` 等比例裁切组件。

- 第 4 步截图聚焦 Agent 详情页中新生成凭据和“一键接入指令”区域。
- 第 5 步截图聚焦 OpenCode 中粘贴指令、调用 AgentWiki 工具并发布页面的过程。
- 第 6 步使用三张纵向排列的证据截图：先展示 OpenCode 最终结果，再展示 AgentWiki 已发布页面，最后展示 AgentWiki 活动记录。每张图配一行简短说明，避免拼图导致文字过小。
- 桌面端和移动端都保持图片比例，不允许通过固定宽高同时拉伸。

## 真实演示与安全

- 创建专用临时凭据，仅授予演示所需的 `spaces:read`、`pages:read`、`pages:write` 和 `review:auto-publish` 权限。
- 使用独立演示 Space，将其自动化审批策略设为 `scoped-auto-publish`，将演示 Agent 的审批模式也设为 `scoped-auto-publish`，并授予演示 Agent 编辑者角色；不修改其他 Space 的发布策略。
- 在独立临时目录运行 OpenCode，避免污染用户已有项目配置。
- 让 OpenCode 执行真实 MCP initialize、`list_spaces`、`propose_page` 和结果确认。
- 截图中不得出现完整 `agk_` 密钥；使用不可逆遮挡覆盖密钥正文，只保留可识别的凭据类型。
- 截图完成后撤销临时凭据、恢复或删除演示 Space，并删除临时 OpenCode 配置。
- 仓库只保存脱敏后的截图，不保存原始截图、提示词中的真实密钥或临时配置。

## 成功与失败文案

成功截图应包含：

- Agent 名称。
- 已接入状态。
- AgentWiki MCP 端点已可用。
- 成功调用 `propose_page` 并报告已发布的页面标题。
- 可访问 Space 名称。
- AgentWiki 中真实存在的已发布页面及其 Agent 来源。

若实测失败，OpenCode 应保留并展示精确错误类别，例如认证失败、权限不足、Host 白名单或网络错误。指南实现不使用伪造成功结果替代真实失败。

## 验证

- 浏览器逐步检查六张步骤卡片的文案、顺序、截图清晰度和响应式裁切。
- 确认所有截图来源于当前真实系统，且不包含密钥。
- 确认 OpenCode 的成功信息、AgentWiki 已发布页面与活动记录来自同一次临时凭据调用。
- 确认演示页面通过 `scoped-auto-publish` 正式发布，而不是停留在待审核状态。
- 运行客户端 ESLint、Vitest、TypeScript/Vite 生产构建和 `git diff --check`。
