# 目标

用户于本轮明确要求“发布”：发布本工作树12项缺陷修复和前轮宿主识别/连接身份修复。Web/API/client 0.12.57，Local Sync 0.13.5，protocol不变0.6.1。

# 状态

- canonical候选已无损快进至GitHub master ec4faa7f（与原cec79c4e树相同），分支仍codex/agent-autochat-external-opencode；应用版本/锁已更新。
- npm官方web登录与whoami已成功（neomei），安全密钥步骤完成。npm registry latest仍为.13.4，.13.5版本空闲。发布前完整测试运行中。
- 新配套生产备份bugs-v01257.oap6txmn已校验并独立复核；API/worker停写约9秒后恢复，三服务和health正常。
- .5版本联动和复审问题已修复：route显式校验版本、指引固定同版runner、current fixture及历史checkpoint矩阵通过；server100、coordinator51、harness23、typecheck/lint及独立复审均通过。第二次完整test:full一次性exit0：8223 pass/5已说明环境skip（test-full-final.log），build/typecheck/lint/protocol registry parity与两种pack独立安装gate均通过。最终发布tarball生成中。
- 尚未提交、推送、npm/GitHub发布或部署。

# 后续

完成兼容修复复审、full suite/build/pack/clean-install；冻结commit/包hash；npm官方发布与回读/空缓存安装；部署并检查源码、公网资源、health及浏览器；原报告追加部署证据，保留原billy验收边界。
