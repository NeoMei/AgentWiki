<!-- codex-memory:template=task-decisions:v1 -->

# 决定记录

只记录这个任务里已经确认的重要决定。

## 记录

- 日期：2026-07-15
- 决定：保持 User、Agent、Space、ChangeSet 的现有领域边界，修复绕过路径而不再引入平行模型。
- 原因：当前模型方向与已冻结的第 3/4/5 条产品决策一致，缺口集中在闭环和约束。
- 影响范围：服务端鉴权、数据库迁移、Worker、Review、Memory、MCP、客户端空间布局与测试。

- 日期：2026-07-15
- 决定：Page/Relation 分离“最初来源”与“最后修改来源”，自动编译只生成可审查 ChangeItem；词法索引属于发布事务，向量索引是可失败的增强。
- 原因：避免人工修改覆盖来源、已发布内容因向量服务失败进入错误重试，以及候选内容绕过审查。
- 影响范围：Prisma、Page、Search、Review、Source pipeline、页面/图谱/Review UI。

- 日期：2026-07-15
- 决定：Worker 使用唯一身份和可续租 fenced lease，周期只回收过期任务；运行期间多次复核原始 credential、Scope、Agent、Grant 和 Space 状态。
- 原因：防止多 Worker 重复执行、启动时重置健康任务，以及撤销凭证后长任务继续发布。
- 影响范围：IngestRun、IngestQueue、SourceService、迁移和恢复测试。

- 日期：2026-07-15
- 决定：不在没有可恢复备份确认时对配置的远程数据库执行 4 个待部署迁移。
- 原因：迁移包含去重、引用迁移和外键修复，属于有数据影响的外部状态变更；隔离 schema 已完成语法与历史一致性验证。
- 影响范围：上线步骤与任务关闭条件，不影响本地代码完成度。

- 日期：2026-07-16
- 决定：远端保持源码直部署，不使用 Docker；API、独立 Worker 和前端由用户级 systemd 分别监管，发布使用 rsync 镜像同步删除陈旧源码。
- 原因：符合既有运行方式与用户明确要求，同时解决旧源码残留、无 Worker、无进程监管和仅编译不启动验证的问题。
- 影响范围：`deploy.sh`、`deploy/systemd/`、`OPERATIONS.md`、健康检查与生产模块图测试。
