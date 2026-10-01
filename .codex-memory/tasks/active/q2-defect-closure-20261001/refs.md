# 证据索引

- 计划agentwiki/docs/superpowers/plans/2026-10-01-q2-defect-closure.md；任务过程.superpowers/sdd/2026-10-01-q2-defect-closure/progress.md（临时，最终转提交证据）。
- 公网TLS证书/密钥公钥指纹匹配，备份公网/root/agentwiki-q2-tls-backup-20261001；nginx -t通过，reload后公网3证书；2026-10-01 12:02 CST外部Node24默认信任fetch /api/health200全部5项ok。
- 隔离本地DB agentwiki_q2_test_20261001/vector0.8.6；独立Redis6388；env /private/tmp/agentwiki-q2-test-runtime/env.sh；生产数据未作为测试数据。
- 生产Assist差异对应既有提交1cb393ba；3份只含源代码的备份/private/tmp/agentwiki-q2-live-assist；部署前必须整合保留。
- 当前正式发布阻点：npm whoami E401；已请求网页登录，未取得credential，不提取密钥。
