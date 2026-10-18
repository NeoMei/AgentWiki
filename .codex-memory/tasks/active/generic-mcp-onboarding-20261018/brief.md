# 通用 MCP 接入与 WorkBuddy 反馈修复

目标：修复三客户端限制、手动复制授权 URL、客户端权限与重启提示不清，以及 Node 预检、doctor 范围、CLI 参数和帮助问题。

状态：隔离候选基于 origin/master 9851195e，初始实现提交1812d6b1。用户指出大量不可访问的页面后，确认状态机测试遗漏浏览器依赖注入，将虚构wiki.test地址交给真实系统浏览器；模拟授权轮询掩盖失败。撤回“真实Chrome验收完成”的结论。现已修复driver隔离、加入真实opener零调用断言，并补齐CLI子进程的跨平台拦截。安全复现10失败→10通过；完整1071通过/1既有skip，根入口8通过；Chrome前后8页无新增、无wiki.test。见browser-isolation-correction.md。这段隔离修复证据不代表真实WorkBuddy接入完成；正式发布与当前真实验收状态见下文，主检出用户修改保留。

交付与证据：agentwiki/docs/verification/generic-mcp-onboarding-20261018/{acceptance.md,review.md,browser-qa.md,browser-opener.json}。

发布前真实验收：旧生产device/start对workbuddy返回HTTP400（仅旧3client）；未开授权页、未新增身份。WorkBuddy5.8.3原生UI显示agentwiki启用34/34工具、原有完全访问；完全退出重启后新会话通过已发布0.13.1原有连接真实调用wiki_get_page读取项目总览。6次MCP执行由原始会话日志佐证，未用终端HTTP替代。新浏览器接入仍未完成。详见workbuddy-real-acceptance.md。

发布候选：0a299231将Web/API提升0.12.48、Local Sync提升0.13.2，protocol0.6.1不变。版本/构建/打包/空缓存门禁和独立审查通过，175文件tarball与源码一致。用户已明确批准发布并继续真实验收，授权持续有效，不需重复审批。

最新发布实况：npm0.13.2正式开放，官方version/latest均0.13.2，tarball与冻结候选字节一致，175文件匹配，空目录/空缓存安装0.13.2与protocol0.6.1通过。首次安全密钥挑战超时及第二次HTTP202/Validating均保留为历史。

固定0a299231部署exit0；生产1357源码匹配，Web/API/client0.12.48、LocalSync0.13.2、protocol0.6.1，Node24.18.0，3active/5healthok；公网HTML和5入口资源exactmatch，previous应用/root/agentwiki-previous-20261019004923保留。公开/api/onboard及真实Chrome指南均显示generic/WorkBuddy、0.13.2和自动浏览器/客户端权限重启提示。

协调备份/var/backups/agentwiki/generic-mcp-v01248.f0el29jz已verified/checksum/writersRestored、154blob匹配，暂停writer约7.114秒；备份后健康通过，未演练恢复。当前真实新WorkBuddy接入正在执行，尚未complete；正式发布成功不代表宿主新授权/新配置/重启/MCP读页完成。见release.json、release-progress.json和workbuddy-real-acceptance.md。

发布后新会话c3b10b4e-5a05-4f1b-9f8e-d9b9a0ada18f已由官方0.13.2直接CLI自动打开真实Chrome授权页，用户授权仍pending、hostVerification未开始。原npx启动被宿主safe-delete在concurrency.lock处拒绝，实际成功路径是任务目录npm install后直跑CLI，不能记录为npx入口通过；新权限/配置/重启/读页仍未完成，见workbuddy-real-acceptance.md。
