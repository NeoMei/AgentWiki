<!-- codex-memory:template=task-decisions:v1 -->

# 决策

- 采用现有单体应用内的独立 `PlatformAdminModule`，不拆第二套管理服务。
- 密码重置为服务端配置的固定值 `12345678`，重置后必须先改密码。
- 删除用户是软删除，保留知识、Space、Agent 与审计归属。
- 锁定动态暂停用户 PAT 与 owner Agent Credential，不改写 Agent 原状态；解锁后恢复。
- 使用 `authVersion` 使重置、锁定、解锁与删除前的 JWT 永久失效。
- 超管不能操作自己，不能锁定或删除最后一个有效超管，关键检查使用 Serializable 事务。
- 第一版只提供运营必需统计，不引入新行为埋点。
- 客户端使用 `/admin`，只对超管显示个人菜单入口，并保留服务端强制权限校验。
- 新文案同时提供中文和英文。
