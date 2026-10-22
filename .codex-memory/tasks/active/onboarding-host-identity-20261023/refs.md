# 证据与继续入口

- 原 Bug page: f31ccf05-70d0-4376-95c3-f507a5bb1bce；Space 项目管理: cmtmgsk5b00neuo709n0x7nqj。
- 新 codex Agent: cmufeiyw2035s12csmaji1t0v；新 connection: 60b8235e-f6a0-5b42-ac68-3b225d844fc4；config: /Users/neomei/.codex/config.toml；新 onboard session: 19935ca2-d072-4328-8b92-ac4fec27bdff。
- 旧运行 connection: 361074ee-0825-4aee-88c1-ca20b56b42de；旧 Agent workbuddy: cmvdy1dqa0ethbu4s9elst5n9；只获 AgentWiki 项目 cmv6biedu005okoisb9fgp64y publisher。
- 新安装 doctor 全项 pass；既有实际 MCP 仅成功读 AgentWiki 项目模板页 f285b898-65ba-4938-8616-e9a0b8f575f5，不能代替目标页授权验收。
- SSH 可复用用户已登录连接：ssh -o BatchMode=yes root@113.249.120.24；旧 /tmp/agentwiki-release-ssh/control 已不存在，不依赖该旧socket。只读查 grant/page归属，无正文查询或权限修改。
- 原扫描/Session修复提交 3f0e9896，候选 HEAD cec79c4e；先前 GitHub master ec4faa7f 与候选 tree 一致，需发布时重新核对。
- 先前生产备份 /var/backups/agentwiki/assist-session-v01256.y9kniutw；旧应用 /root/agentwiki-previous-20261022040109。新发布前必须重新协调备份，不沿用过期备份判断。
- 主修改：apps/client/src/features/about/onboardPrompt.ts；apps/server/src/core/agent/local-sync-installation.service.ts；apps/server/src/onboard/onboard-runtime-guide.ts 与 onboard.controller.ts；packages/local-sync/src/onboarding/preflight.ts；packages/local-sync/src/gateway/{entry,server}.ts。
