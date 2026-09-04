# 决策

- 首轮审查代理只读并行，所有发现由主线先复现和裁决，避免共享工作区竞争。
- 上一轮 PASS 只是基线；本轮必须在最终不可变代码上重做全仓、CodeGraph、Playwright 和 clean-clone 门禁。
- 任何产品 bug 先根因定位和观察 RED，再做最小修复；环境前置失败必须与产品回归分开记录。
- 数据库和服务仅使用 loopback 与 disposable test 资源；全部由主控程序精确创建和清理。
