# 通用 MCP 接入与 WorkBuddy 反馈修复

目标：修复三客户端限制、授权链接衔接、客户端权限/重启提示、Node 预检、doctor 范围和 CLI 帮助，并以真实宿主验证接入结果。

当前：用户明确要求发布指引补修。正式候选 `1e3fb14001ec33f1c77be1dbfe86f9b02406d382` 包含 d23bd089 指引修正、公开 API 指南同步、精确包版本检查点及跨版本误续进保护；Web/API 0.12.49、Local Sync 0.13.3、protocol 0.6.1。独立审查与候选门禁通过，npm 已发布并完成官方包/175 文件/空缓存安装验证。Web/API 已从冻结导出部署成功：1357 源码零差异、3 服务 active、5 项健康通过，公网 HTML 与 5 入口资源匹配。真实 Chrome 已展开 WorkBuddy 0.13.3 指令，公开 API 八项指引核对通过。部署后既有 WorkBuddy 连接新发起真实 MCP 读页已独立核对成功，原生 UI 一致；本轮发布完成。

npm 官方 version/latest 均 0.13.3；正式 tarball SHA256 `032773b2da2ddd8e53d1dd1aefe42922dfe0d9d58f0a9d803a0ea0ab333acdf3`。此次安全密钥认证成功、publish exit0；metadata 可用而 tarball 暂时 404 时保持等待，正式包可取后才通过回读。协调备份 `/var/backups/agentwiki/generic-mcp-v01249.gzemy54b` 已 verified、154 blob 匹配、writers 已恢复；未做恢复演练。

验收边界：先前 0.13.2 真实浏览器用户授权、客户端信任 34/34、两次完整重启及 reader MCP 读页已有独立证据，但成功依赖固定官方包和绝对 Node24/CLI 路径的本机修正。原始 npx safe-delete 拒绝及默认托管 Node22 尚未修复，本轮没有将其包装为兼容修复。当前 WorkBuddy 配置保留；新后端部署后仅使用该既有连接验证读页兼容：新增调用 line26 → line27 completed，18:01:50.664Z 返回 8156B，SHA256 `34e06f9db48b768de26609aa4962c5ec168fd206f670a32a036c44b17032436b` 与此前一致，只有真实 MCP 派发，无终端或其他工具替代。配置未变，未重采运行时进程；不新建身份、不冒充 0.13.3 全新默认接入验收。

历史纠正保留：首次“真实 Chrome 验收”曾被错误地建立在 wiki.test 模拟状态机开窗上，该结论已撤回，浏览器依赖注入和 opener 零调用回归已修复。完整过程见旧目录 browser-isolation-correction.md 和 workbuddy-real-acceptance.md；不以新文档覆盖原始错误及真实 0.13.2 证据。

本轮记录：`agentwiki/docs/verification/workbuddy-guidance-20261019/{release-candidate.json,review.json,release.json}`。当前收口：npm/生产/真实指南和既有客户端兼容读页均通过，发布与回执已完成；后续仍需处理默认路径问题，未实测的 0.13.3 全新授权边界继续保留。
