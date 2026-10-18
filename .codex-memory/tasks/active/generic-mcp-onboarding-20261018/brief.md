# 通用 MCP 接入与 WorkBuddy 反馈修复

目标：修复三客户端限制、手动复制授权 URL、客户端权限与重启提示不清，以及 Node 预检、doctor 范围、CLI 参数和帮助问题。

状态：隔离候选基于 origin/master 9851195e，初始实现提交1812d6b1。用户指出大量不可访问的页面后，确认状态机测试遗漏浏览器依赖注入，将虚构wiki.test地址交给真实系统浏览器；模拟授权轮询掩盖失败。撤回“真实Chrome验收完成”的结论。现已修复driver隔离、加入真实opener零调用断言，并补齐CLI子进程的跨平台拦截。安全复现10失败→10通过；完整1071通过/1既有skip，根入口8通过；Chrome前后8页无新增、无wiki.test。见browser-isolation-correction.md。真实WorkBuddy接入仍未验收完成。主检出用户修改保留，未发布 npm/部署生产，也未改本机 WorkBuddy/Codex 配置。

交付与证据：agentwiki/docs/verification/generic-mcp-onboarding-20261018/{acceptance.md,review.md,browser-qa.md,browser-opener.json}。

最新真实验收：生产device/start对workbuddy返回HTTP400（仅旧3client）；未开授权页、未新增身份。WorkBuddy5.8.3原生UI显示agentwiki启用34/34工具、原有完全访问；完全退出重启后新会话通过已发布0.13.1原有连接真实调用wiki_get_page读取项目总览。6次MCP执行由原始会话日志佐证，未用终端HTTP替代。新浏览器接入仍未完成。详见workbuddy-real-acceptance.md。

发布候选：0a299231将Web/API提升0.12.48、Local Sync提升0.13.2，protocol0.6.1不变。版本/构建/打包/空缓存门禁和独立审查通过，175文件tarball与源码一致。发布许可已向用户提出，尚未获回复；未发布npm、未部署生产。下一步获准后先正式npm回读/安装，再同步部署Web/API；随后继续真实浏览器授权、新配置、客户端权限与重启读页。
