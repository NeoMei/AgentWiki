# 通用 MCP 接入：本地浏览器验收

日期：2026-10-18（Asia/Shanghai）。环境：隔离工作树中的 Vite 本地源码；**不是生产部署或已发布 npm 包验收**。页面显示的 0.13.1 是当时尚未统一更新的版本常量，不代表 npm 0.13.1 已含本轮功能。

入口为 `http://127.0.0.1:5274/onboard`，真实跳转至 `/guide/agent-onboard`，标题为 AgentWiki。Vite 以 `127.0.0.1` 启动，API 仅指向 `http://127.0.0.1:5275` 的临时只读 fixture；未执行真实 onboard、未访问生产授权、未新建身份或连接。

浏览器使用 CUA Chrome extension。尝试 IAB 返回 `Browser is not available: iab` 后，使用同一 CUA 工具切换到可用 Chrome；未调用独立 Playwright 浏览器。桌面 CSS 视口 1554×865。Chrome 原有 110% 缩放导致 viewport 390 请求对应 CSS 354；调整临时 viewport 为 429×928 后实测 CSS 390×843，结束时已重置 viewport。

| 检查 | 结果与证据 |
| --- | --- |
| 路由、非空页面、框架错误遮罩 | 通过。公开入口跳转正确，完整接入内容渲染，无错误遮罩。 |
| 默认通用入口 | 通过。通用 MCP 为选中状态，Codex 未选中；提示为导出标准 MCP 配置并导入当前客户端。 |
| WorkBuddy 切换 | 通过。选中 WorkBuddy 后说明变为写入该客户端配置，展开提示词含 `--client workbuddy`。 |
| 复制反馈 | 通过 UI 状态检查。点击复制后显示已复制；切换客户端或语言后旧复制状态清除。CUA 的 clipboard accessor 未返回与刚复制提示词匹配的文本，因此**未宣称系统剪贴板逐字回读通过**；未记录剪贴板内容。组件测试覆盖传给 clipboard.writeText 的完整提示词。 |
| 中英文 | 通过。入口、步骤、提示词和授权后提醒均提供两种语言，刷新后英文设置保留。 |
| 390px 布局 | 通过。中文、英文、WorkBuddy 展开提示词、授权页均实测 `scrollWidth = clientWidth = 390`；选项换行、按钮和文字可读。 |
| 授权后的操作提示 | 通过本地只读 fixture 渲染。generic 中文与 WorkBuddy 英文均显示允许 MCP/工具、重载或重启、新对话，以及返回客户端完成配置和真实读页。 |
| macOS 自动打开浏览器 | 通过。Node v24.18.0 调用实际 `openAuthorizationBrowser`，默认 runner 执行系统 `open`，返回 true；CUA 确认新增标签页 URL、标题 AgentWiki 及默认通用入口。仅打开本地只读页面，不代表授权批准。 |
| 控制台 | CUA `dev.logs` 的 error/warn 结果为空；无可见运行错误。 |
| 回执字段契约 | Review 发现提示词误写了 helper 函数名 `clientSetupInstructions` 为嵌套响应。已改为响应顶层 `configurationMode/configPath/hostActivationSteps`，9 项 OnboardPage 测试通过，浏览器展开文本确认不再含错误嵌套名。 |

授权页 fixture 只识别 `TEST-GEN1` 和 `TEST-WRK1` 两个测试码，返回 `purpose=agent-connect,status=approved` 的固定公开字段，所有 POST 拒绝（405）。因此 fixture 验证的是已授权状态的页面显示，**不证明真实账号授权、WorkBuddy 重载或宿主 MCP 读取成功**。浏览器打开函数另有真实 macOS 打开本地只读页面的独立验证。

## 截图

- `01-onboard-generic-zh.jpg`：桌面默认通用入口。
- `02-onboard-workbuddy-zh.jpg`：桌面 WorkBuddy 选择、复制反馈与展开提示词。
- `03-onboard-generic-en.jpg`：英文通用入口与复制反馈。
- `04-onboard-mobile-en.jpg`：实际 CSS 390px 英文首屏。
- `05-onboard-mobile-zh.jpg`：实际 CSS 390px 中文首屏。
- `06-device-workbuddy-approved-en.jpg`：WorkBuddy 已授权固定状态及客户端后续操作。
- `07-device-generic-approved-zh.jpg`：通用 MCP 已授权固定状态及客户端后续操作。
- `08-system-browser-opener.jpg`：实际系统 open 创建的新标签页。

## 边界

浏览器真实页面、按钮状态、响应式和文案通过；本轮未安装或重启 WorkBuddy，未修改本机 MCP 配置，未提交真实授权，未把网关检查等同于当前宿主成功读取。OS opener 独立实证见 `browser-opener.json`。全部验收标签页已关闭，临时 Vite 和 fixture 服务已停止。
