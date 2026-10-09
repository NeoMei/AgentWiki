# AgentWiki v0.12.18 发布记录

本版在 v0.12.17 的全页文档画布、阅读/编辑工作区和来源语义基础上，发布 Space 成员委派自有 Agent 的能力。成员只能选择自己拥有的 active Agent，Agent 角色上限由该成员在目标 Space 的实时角色决定；服务端在授权和连接签发时再次校验，客户端选项过滤不代替服务端鉴权。

## 变更

- viewer 最多委派 `reader`，editor 最多委派 `editor`，admin/owner 可委派 `publisher`。
- 成员只能委派自己拥有的 Agent；不能借此获得成员管理、审核或超出本人 Space 角色的权限。
- Agent 详情、Space 成员页和 Local Sync 连接入口显示同一角色上限，并保留中英文提示。
- 应用全宽文档画布及 OpenKnowledge 借鉴的工作区能力随 v0.12.17 主线保留；本版不新增 Prisma migration、Local Sync npm 包或同步协议版本。

## 验证

- Agent 委派服务端定向测试：4 suites / 100 tests passed。
- Agent 委派客户端定向测试：4 files / 61 tests passed。
- 客户端全量测试：141 files / 2245 tests passed；typecheck、lint 和生产构建通过。
- 仓库全量 harness 已启动，但 10 个数据库测试因未配置专用 `PAGE_TEMPLATE_TEST_DATABASE_URL` 等环境门禁而失败；这些结果未计作产品回归或全量通过。

## 发布边界

应用版本为 `0.12.18`；Local Sync 保持 `0.11.0`，同步协议保持 `0.6.1`。GitHub 发布和生产部署分别记录。生产 SSH 只读预检当前返回 `Permission denied (publickey,password)`，恢复既有 SSH 控制连接后才能执行生产部署与公网回读。
