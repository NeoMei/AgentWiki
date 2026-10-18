# 决策

- 默认 generic，支持任何具有本地 stdio MCP 能力的宿主；不猜测未知宿主配置位置。
- generic 导出 ~/.config/agentwiki/mcp.json（避开运行状态归档）；workbuddy 使用官方 ~/.workbuddy/mcp.json，保留旧三客户端快捷项。
- Node24/26 在授权/换码/写状态前检查；不替用户升级Node。
- 自动打开仅同源授权 URL，失败回退链接，保留浏览器用户确认；status只读、恢复不反复开窗。
- 配置成功、网关检查、宿主授权/重启、真实宿主读页是独立证据。
- doctor --all-clients 检查已知配置，缺少可选宿主为 unverified；generic不冒充实际注册。
- 已有Agent接入命令当前源码候选用generic、历史包保留auto；正式发布必须同步提升版本，不能把当前候选以0.13.1重新发布。
- 同名未知MCP必须在preflight/写入前拒绝；用户保留或重命名冲突条目后，同一session重新确认，不重新建身份。
- 模拟授权测试必须显式注入浏览器依赖，并断言真实opener零调用；系统命令成功与mock轮询成功不能当作页面可访问或真实授权成功。用户反馈发现的wiki.test开窗漏口与验收结论更正记录在browser-isolation-correction.md。
