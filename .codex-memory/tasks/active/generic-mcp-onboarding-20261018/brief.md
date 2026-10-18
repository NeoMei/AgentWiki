# 通用 MCP 接入与 WorkBuddy 反馈修复

目标：修复三客户端限制、手动复制授权 URL、客户端权限与重启提示不清，以及 Node 预检、doctor 范围、CLI 参数和帮助问题。

状态：隔离候选基于 origin/master 9851195e，初始实现提交1812d6b1。用户指出大量不可访问的页面后，确认状态机测试遗漏浏览器依赖注入，将虚构wiki.test地址交给真实系统浏览器；模拟授权轮询掩盖失败。撤回“真实Chrome验收完成”的结论。现已修复driver隔离、加入真实opener零调用断言，并补齐CLI子进程的跨平台拦截。安全复现10失败→10通过；完整1071通过/1既有skip，根入口8通过；Chrome前后8页无新增、无wiki.test。见browser-isolation-correction.md。这段隔离修复证据不代表真实WorkBuddy接入完成；正式发布与当前真实验收状态见下文，主检出用户修改保留。

交付与证据：agentwiki/docs/verification/generic-mcp-onboarding-20261018/{acceptance.md,review.md,browser-qa.md,browser-opener.json}。

发布前真实验收：旧生产device/start对workbuddy返回HTTP400（仅旧3client）；未开授权页、未新增身份。WorkBuddy5.8.3原生UI显示agentwiki启用34/34工具、原有完全访问；完全退出重启后新会话通过已发布0.13.1原有连接真实调用wiki_get_page读取项目总览。6次MCP执行由原始会话日志佐证，未用终端HTTP替代。新浏览器接入仍未完成。详见workbuddy-real-acceptance.md。

发布候选：0a299231将Web/API提升0.12.48、Local Sync提升0.13.2，protocol0.6.1不变。版本/构建/打包/空缓存门禁和独立审查通过，175文件tarball与源码一致。用户已明确批准发布并继续真实验收，授权持续有效，不需重复审批。

最新发布实况：npm0.13.2正式开放，官方version/latest均0.13.2，tarball与冻结候选字节一致，175文件匹配，空目录/空缓存安装0.13.2与protocol0.6.1通过。首次安全密钥挑战超时及第二次HTTP202/Validating均保留为历史。

固定0a299231部署exit0；生产1357源码匹配，Web/API/client0.12.48、LocalSync0.13.2、protocol0.6.1，Node24.18.0，3active/5healthok；公网HTML和5入口资源exactmatch，previous应用/root/agentwiki-previous-20261019004923保留。公开/api/onboard及真实Chrome指南均显示generic/WorkBuddy、0.13.2和自动浏览器/客户端权限重启提示。

协调备份/var/backups/agentwiki/generic-mcp-v01248.f0el29jz已verified/checksum/writersRestored、154blob匹配，暂停writer约7.114秒；备份后健康通过，未演练恢复。最终本机真实接入已在固定官方0.13.2+绝对Node24配置补正后通过；默认npx路径未通过，范围见下文。见release.json、release-progress.json和workbuddy-real-acceptance.md。

发布后同一session c3b10b4e-5a05-4f1b-9f8e-d9b9a0ada18f已真实浏览器允许，创建reader Agent cmve2uzzo00atx1bm3j91lo13并安装completed/备份成功。首次完全重启85486→退出→15551，客户端信任提示后绿灯34/34；第一次信任批准者未归因主任务。新会话b1ea8cb0…真实MCP读页/reader通过，但实际运行Node22不受支持，wiki_identity不存在且onboard_status无当前身份，不能称全通过。

本机已将同一连接备份后改为稳定官方175文件匹配安装与`/usr/local/bin/node`（Node24）+绝对CLI；第二次15551全退出重启后，主任务明确点击该新配置的客户端信任。最终独立证明：新主PID20291，gateway24353实际/usr/local/bin/node v24.18.0，官方175文件与冻结包一致；新会话f3aa7904…仅工具发现和MCP派发，reader及两次8156B/同SHA真实读页通过。本机外部host验收passed，CLI hostVerification仍not_started；身份来自actual argv+local mapping，不是onboard_status。原npx接入safe-delete拒绝及默认网关Node22未修复，本机runtime修正不能冒充默认路径成功。指引补修d23bd089已提交/测试但未发布，正式0.13.2/Web0.12.48仍固定0a299231；本机验收已完成，产品后续边界保留。
