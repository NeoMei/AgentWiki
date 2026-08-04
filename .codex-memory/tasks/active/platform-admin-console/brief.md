<!-- codex-memory:template=task-brief:v1 -->

# platform-admin-console

## 目标

实现只对平台超管开放的管理后台，提供用户与核心资源统计、用户搜索/筛选/分页、默认密码重置、强制改密码、锁定/解锁与软删除。

## 当前状态

- 需求、方案、后端语义、前端交互与测试范围已逐项获得用户确认。
- 设计使用现有 human `platformRole=super_admin`，新增独立 `PlatformAdminModule` 与 `/admin` 客户端路由。
- 当前处于书面 spec 待用户审阅阶段，未开始业务代码实现。

## 下一步

- 用户审阅并确认书面 spec。
- 调用 writing-plans 生成测试驱动实施计划。
- 按计划实现、全量验证，在获得部署授权后按备份优先顺序发布。
