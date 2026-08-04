# AgentWiki 平台管理后台设计

## 目标

为 AgentWiki 平台超级管理员提供独立管理后台，用于查看用户与核心业务统计，并安全地执行密码重置、锁定、解锁和软删除用户。

该能力建立在已有 `User.platformRole = super_admin` 之上，不引入第二套身份体系，也不把平台权限传递给 Agent。

## 已确认决策

- 在现有 NestJS 和 React 应用内新增独立的平台管理模块，不单独拆分管理端服务。
- 重置后的固定默认密码为 `12345678`，通过服务端环境变量配置，不在前端硬编码。
- 使用默认密码登录后必须先修改密码，才能使用其他功能。
- 删除用户采用软删除；知识内容、Space、Agent 和审计归属均保留。
- 锁定用户时，用户登录、个人 Token 与其名下 Agent 凭据全部暂停；解锁后 Token 和 Agent 凭据恢复原状态。
- 统计范围为第一版运营必需指标，不扩展为完整产品分析系统。

## 方案与边界

新增 `PlatformAdminModule`，封装平台统计、用户查询和账户操作。它可以依赖现有 `PrismaService`、`AuthService` 与 `AuditService`，但不把管理端点混入普通 `UserController`。

边界如下：

- 平台管理员必须是当前有效的 human User，且 `platformRole` 为 `super_admin`。
- Agent、普通 human User 与被锁定/删除的超管均不得调用管理接口。
- 平台管理能力不改变 Space owner/admin/editor/viewer 的业务角色模型。
- 管理后台不支持创建用户、恢复已删除用户、转移内容归属或修改平台角色。

## 数据模型

`User` 新增三个字段：

- `lockedAt DateTime?`：非空表示账户被平台锁定。
- `mustChangePassword Boolean @default(false)`：用于强制默认密码登录后先改密码。
- `authVersion Int @default(0)`：写入 JWT；密码重置、锁定、解锁和软删除时递增，使旧 JWT 立即失效。

数据库迁移必须为旧用户补齐非破坏性默认值，不更改现有 `deletedAt`、`platformRole` 和关联删除策略。

## 认证与凭据语义

### JWT

- JWT 增加 `authVersion` 与 `passwordChangeRequired` claim。
- 每次 JWT 验证仍从数据库重新加载 User，并校验 `deletedAt`、`lockedAt` 和 `authVersion`。
- 锁定、删除或版本不匹配时认证失败。解锁后旧 JWT 不恢复，用户必须重新登录。

### 强制修改密码

- 默认密码校验成功后可签发受限 JWT，但 `passwordChangeRequired=true`。
- 受限 JWT 只能调用修改必需密码的端点和读取当前身份所需的最小端点；其他业务请求统一拒绝。
- 新密码必须通过现有注册密码规则，且不能等于默认密码。
- 修改成功后清除 `mustChangePassword`、再次递增 `authVersion`，并返回新的正常 JWT 和 User 摘要。

### 个人 Token 和 Agent 凭据

- 个人 API Key 验证增加 User `lockedAt` 检查。
- Agent Credential 验证继续加载 Agent owner，并增加 owner `lockedAt` 检查。
- 锁定只通过 owner 状态动态暂停凭据，不改写 Agent 原有 `active`/`paused`/`revoked` 状态，因此解锁可以准确恢复原状态。
- 软删除继续依靠 owner `deletedAt` 永久拒绝凭据，不删除 Agent 或历史凭据记录。

## 管理 API

所有路由以 `/api/platform-admin` 为前缀：

### `GET /stats`

返回：

- `users.total`：所有 human User 记录，包含已删除。
- `users.active`：`deletedAt` 与 `lockedAt` 均为空。
- `users.locked`：未删除且 `lockedAt` 非空。
- `users.deleted`：`deletedAt` 非空。
- `users.new7d` 与 `users.new30d`：按 `createdAt` 统计的新注册 human User。
- `spaces`：未删除 Space 数。
- `pages`：未删除/归档正式页面数。
- `agents`：未撤销 Agent 数。
- `userTrend30d`：连续 30 个自然日的新注册数，缺失日期填 0。
- `recentUsers`：最近注册的 10 名 human User，包含当前状态。

### `GET /users`

支持：

- `query`：对姓名和邮箱执行大小写不敏感包含搜索。
- `status=all|active|locked|deleted`。
- `platformRole=all|user|super_admin`。
- `page` 与 `limit`；`limit` 有服务端上限。

每个用户返回 id、姓名、邮箱、平台角色、状态时间、创建时间、Space 成员数和所有 Agent 数。不返回密码哈希、Token 哈希或其他凭据材料。

### 账户操作

- `POST /users/:id/reset-password`
- `POST /users/:id/lock`
- `POST /users/:id/unlock`
- `DELETE /users/:id`

重置密码返回成功状态与当前配置的默认密码，仅供当次超管操作界面展示和复制；密码不进入日志、审计 metadata 或前端持久化存储。

### 强制改密码

- `POST /api/auth/change-required-password`

请求携带受限 JWT，并提交新密码与确认值。成功后返回正常 JWT 及更新后的当前用户。

## 权限、并发与安全保护

- 使用专用 `PlatformSuperAdminGuard`，根据当次认证从数据库加载的 `platformRole`、`lockedAt` 与 `deletedAt` 判断，不只信任 JWT 内的旧 claim。
- 超管不能对自己执行重置密码、锁定、解锁或删除。
- 锁定或删除 `super_admin` 前，必须确认操作后仍至少有一个未锁定、未删除的超管。
- 上述检查与状态更新在 PostgreSQL Serializable 事务内完成，并对可重试的串行化冲突执行有界重试，避免两名超管同时被操作导致无可用超管。
- 锁定和软删除必须使现有 WebSocket 认证在下次连接/重验证时拒绝该用户。
- 默认密码从 `PLATFORM_DEFAULT_USER_PASSWORD` 读取；正式环境缺失或不符合密码长度规则时，管理模块启动失败且给出明确运维错误。部署配置设为 `12345678`。
- 管理操作不在 URL、query string 或客户端日志中传递默认密码。

## 审计

每次管理操作记录：

- actor User id
- target User id
- action：`platform_user.password_reset`、`platform_user.lock`、`platform_user.unlock`、`platform_user.delete`
- outcome：`success` 或 `failure`
- IP、User-Agent、时间和不含敏感信息的失败原因代码

不得记录明文新密码、默认密码、密码哈希或完整 Token。

## 前端设计

### 入口与路由

- 新增受保护路由 `/admin`。
- 右上角个人菜单中增加“平台管理 / Platform admin”，仅对 `super_admin` 显示。
- 路由组件不依赖菜单隐藏作为安全措施；普通用户直接访问 `/admin` 显示 403 状态并返回工作台。

### 统计概览

- 白底卡片展示用户总数、正常、锁定、已删除、7 天新增、30 天新增、Space、页面和 Agent 数。
- 30 天新增用户趋势使用轻量条形/折线视图，不为此引入大型图表依赖。
- 最近注册列表展示用户名、邮箱、注册时间和账户状态。

### 用户管理

- 支持姓名/邮箱搜索、账户状态筛选、平台角色筛选和分页。
- 列表展示头像占位、姓名、邮箱、平台角色、Space 数、Agent 数、注册时间与账户状态。
- 桌面端将操作放在行末；移动端使用可水平滚动的紧凑表格，操作列保持可达。
- 当前超管行显示“当前账号 / Current account”，不渲染任何账户操作。
- 锁定、解锁、删除与密码重置使用明确确认弹窗；删除是危险样式。
- 密码重置成功弹窗显示 `12345678` 和复制按钮，关闭后不在组件、URL 或 localStorage 中保留该值。

### 强制改密码页

- 登录响应中 `mustChangePassword=true` 时，前端进入专用改密码状态，不进入工作台。
- 页面只包含账号说明、新密码、确认密码、提交和退出登录。
- 新密码校验规则与注册保持一致，同时明确禁止继续使用 `12345678`。

所有新文案同时提供中文和英文，并覆盖加载、空状态、失败、成功、禁用和确认状态。

## 错误处理

- 非超管：403，不泄露统计或用户存在性。
- 目标不存在：404。
- 操作自己：409 业务错误。
- 操作会导致无可用超管：409 业务错误。
- 锁定已锁定用户、解锁已解锁用户：返回幂等成功，不反复递增 `authVersion`。
- 删除已删除用户：返回幂等成功摘要，不更改原始 `deletedAt`。
- 序列化冲突：服务端有界重试；超过重试次数后返回可操作的冲突错误。
- 统计局部查询失败不返回虚假 0，整个统计请求失败并允许重试。

## 测试设计

### 服务端

- Guard：超管通过；普通用户、Agent、锁定/删除超管拒绝。
- 统计：各状态计数、7/30 天新增、30 天补零趋势和最近用户。
- 列表：搜索、状态/角色筛选、分页上限、关联计数和敏感字段排除。
- 重置：密码哈希变更、`mustChangePassword`、`authVersion`、旧 JWT 失效和审计。
- 强制改密码：受限 JWT 业务隔离、密码规则、禁止默认密码、完成后新 JWT。
- 锁定/解锁：JWT、PAT 和所有者 Agent Credential 的暂停与恢复。
- 软删除：认证全部失效但内容与关联保留。
- 安全约束：不可自操作、最后超管、并发事务与敏感数据不入审计。

### 客户端

- 菜单入口和路由权限。
- 统计卡片、趋势和最近用户加载/错误状态。
- 搜索、筛选、分页和快速重试的稳定性。
- 当前账号无操作；其他用户按状态展示正确操作。
- 各确认弹窗、默认密码一次性显示/复制与关闭清理。
- 默认密码登录后强制改密码，不能绕过到工作台。
- 中英文文案和可访问名称。

### 真实系统验收

- 在真实 PostgreSQL/Redis 上创建临时普通用户和 Agent，验证重置、强制改密码、锁定、解锁、软删除与凭据行为。
- 验证普通用户与 Agent 无法调用管理 API。
- 使用真实浏览器验证桌面端、390x844 移动端、中文和英文界面。
- 检查控制台错误、未处理请求、水平溢出和敏感数据持久化。

## 部署顺序

1. 备份生产 PostgreSQL。
2. 设置 `PLATFORM_DEFAULT_USER_PASSWORD=12345678`。
3. 发布代码并执行 Prisma migration 与 `prisma generate`。
4. 构建前后端，重启 API、Worker 和 Frontend systemd 服务。
5. 验证 `/api/health`、普通登录、超管登录和管理页加载。
6. 用临时用户完成管理行为冒烟验收并清理临时数据。

## 完成标准

- 只有有效超管可访问管理 API 和管理页。
- 统计、搜索、筛选、分页和用户关联数据与数据库一致。
- 重置密码为 `12345678` 后，旧会话失效且必须先修改密码。
- 锁定期间 JWT、PAT 与 owner Agent Credential 全部失效；解锁后 PAT 和 Agent Credential 恢复，旧 JWT 不恢复。
- 软删除后认证与凭据永久失效，但知识、Space、Agent 和审计归属保留。
- 自操作、最后超管与并发超管操作受到服务端保护。
- 所有操作存在不含敏感数据的持久化审计记录。
- 服务端、客户端、真实数据库、真实 API 和真实浏览器验收均通过。

## 不做

- 不提供批量删除、批量锁定或用户恢复。
- 不在后台修改用户的 Space 角色或 Agent 细粒度权限。
- 不提供平台角色授予/撤销界面。
- 不硬删除用户关联的知识、Space、Agent、审计或凭据记录。
- 不收集本版运营统计之外的新行为埋点。
