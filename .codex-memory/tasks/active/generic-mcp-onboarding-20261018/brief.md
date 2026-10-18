# 通用 MCP 接入与 WorkBuddy 反馈修复

目标：修复三客户端限制、手动复制授权 URL、客户端权限与重启提示不清，以及 Node 预检、doctor 范围、CLI 参数和帮助问题。

状态：隔离候选基于 origin/master 9851195e，初始实现提交1812d6b1。用户指出大量不可访问的页面后，确认状态机测试遗漏浏览器依赖注入，将虚构wiki.test地址交给真实系统浏览器；模拟授权轮询掩盖失败。撤回“真实Chrome验收完成”的结论。现已修复driver隔离、加入真实opener零调用断言，并补齐CLI子进程的跨平台拦截。安全复现10失败→10通过；完整1071通过/1既有skip，根入口8通过；Chrome前后8页无新增、无wiki.test。见browser-isolation-correction.md。真实WorkBuddy接入仍未验收完成。主检出用户修改保留，未发布 npm/部署生产，也未改本机 WorkBuddy/Codex 配置。

交付与证据：agentwiki/docs/verification/generic-mcp-onboarding-20261018/{acceptance.md,review.md,browser-qa.md,browser-opener.json}。

下一步：正式发布时必须先提升 Local Sync 新版本并同步 Web/API 版本、服务端允许范围及精确版本命令，再执行正式打包/发布/部署门禁。现有已发布0.13.1不含此候选功能；原 WorkBuddy 安装、用户许可、重载后真实页读取仍待验。
