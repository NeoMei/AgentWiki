# 决策

- 本轮“发布”解释为提交并推送 GitHub `master`，用于跨电脑拉取；不自动发布 npm，也不部署生产。
- Mac 验证只能使用 loopback 上的 disposable PostgreSQL/pgvector 与 Redis AOF，数据库名必须包含 `test`。
- 根测试的专用数据库变量可以指向同一 disposable 测试数据库，但各 harness 仍必须使用自己的随机前缀 schema。
- 全栈 Playwright 使用独立 `mac_e2e_*` schema，并在退出时只删除该精确 schema。
- CodeGraph 必须使用独立安装的真实可执行文件，不允许用 mock 把环境缺口伪装为通过。
