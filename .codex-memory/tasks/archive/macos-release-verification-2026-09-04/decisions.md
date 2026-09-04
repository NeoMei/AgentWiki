# 决策

- 本轮“发布”解释为提交并推送 GitHub `master`，用于跨电脑拉取；不自动发布 npm，也不部署生产。
- Mac 验证只能使用 loopback 上的 disposable PostgreSQL/pgvector 与 Redis AOF，数据库名必须包含 `test`。
- 根测试的专用数据库变量可以指向同一 disposable 测试数据库，但各 harness 仍必须使用自己的随机前缀 schema。
- 全栈 Playwright 使用独立 `mac_e2e_*` schema，并在退出时只删除该精确 schema。
- CodeGraph 必须使用独立安装的真实可执行文件，不允许用 mock 把环境缺口伪装为通过。
- Task 1 首次发现 Docker 缺失后，用户在 Task 2 期间安装 Docker Desktop；被替代的 native 尝试不计为发布证据，最终只采用计划要求的 Docker PostgreSQL/pgvector 与 Redis AOF。
- 原始 `agentwiki_test.public` 的 63 张诊断污染表保留到 disposable PostgreSQL 容器销毁，不在共享式运行期间单独清理，也不掩盖为 clean。
- Task 5 清理以完整 PGID 实时成员、命令、CWD 和 listener 归属为门禁；只有全部与快照一致后才允许组级 TERM。
- 临时附件不做 broad `rm`，只将精确随机目录移动到唯一废纸篓 bucket；原路径消失即满足清理，可恢复副本保留。
- 最终 PASS 只针对已测试代码 `e8c16e92822758a75350e50d9abb7865cc970f54`；证据文档随后独立提交，push 交由控制器终审决定。
