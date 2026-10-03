# 证据索引

- 计划agentwiki/docs/superpowers/plans/2026-10-01-q2-defect-closure.md；任务过程.superpowers/sdd/2026-10-01-q2-defect-closure/progress.md（临时，最终转提交证据）。
- 公网TLS证书/密钥公钥指纹匹配，备份公网/root/agentwiki-q2-tls-backup-20261001；nginx -t通过，reload后公网3证书；2026-10-01 12:02 CST外部Node24默认信任fetch /api/health200全部5项ok。
- 隔离本地DB agentwiki_q2_test_20261001/vector0.8.6；独立Redis6388；env /private/tmp/agentwiki-q2-test-runtime/env.sh；生产数据未作为测试数据。
- 生产Assist差异对应既有提交1cb393ba；3份只含源代码的备份/private/tmp/agentwiki-q2-live-assist；部署前必须整合保留。
- npm认证已由用户网页登录完成；正式protocol0.6.1/local-sync0.10.1发布成功，协议字节parity与公开包干净安装双publisher16scopes/rawplan/tamperReject通过。
- 插件0.5.6早期实际公网20检查：报告.superpowers/sdd/2026-10-01-q2-defect-closure/task-8-verification-report.md；自建Space/Vault/credentials全清理；实际v2legacy，非nativeGUI/v3。

- 2026-10-01最终生产0.12.11代码5638dd8d；1421文件核验，三服务active/public默认TLS五项ok；配对备份/var/backups/agentwiki/q2-v01211-20261001182522。
- Local Sync0.10.2正式包SHA1 4723623a626c674fa8051c465bf805c95e943393、Linux干净安装CLI/gateway通过。
- 双publisher真实公网/MCP/16scope/tamper/cleanup：/private/tmp/agentwiki-q2-live-onboarding-postdeploy.log，exit0。插件正式0.5.6新服务20项+cleanup：/private/tmp/agentwiki-q2-plugin-postdeploy.log，exit0。
- Chrome最终18主项PASS/cleanedtrue+pausedSupplementtrue：/private/tmp/agentwiki-q2-business-check/results.json及README，分轮证据保留，不将未覆盖feature-off/nativeGUI等算作通过。
- GitHub正式release https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.11，标签对应生产执行代码5638dd8d；master验收文档更新单独提交。
