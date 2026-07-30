# Space 添加智能体成员设计

## 目标

让 Space 的所有者或管理员在现有“添加成员”入口中，既能添加已注册用户，也能添加当前登录用户自己拥有的智能体。添加智能体的本质仍是创建 `AgentGrant`，不引入第二套成员或权限模型。

## 已确认范围

- “添加成员”弹窗包含“用户”和“智能体”两个状态。
- 智能体候选仅来自当前登录用户拥有、未撤销且状态为 `active` 的 Agent。
- 已经拥有当前 Space Grant 的 Agent 不再显示为可选项。
- Agent 只能选择 `viewer` 或 `editor`，不能成为 Space 的 `owner` 或 `admin`。
- 选择角色后自动应用默认权限；添加成功后仍可在现有成员卡片中调整全部细粒度权限。
- Space `owner` 和 `admin` 均可执行添加；人类成员的现有邮箱添加流程保持不变。
- 服务端创建新 Agent Grant 时同样校验 Agent 属于当前调用者，不能只依赖客户端候选过滤。
- Space 管理员仍可调整或移除 Space 中已经存在的任意 Agent Grant；“只能添加自有 Agent”不削弱已有成员管理权。

## 方案

采用现有弹窗内的成员类型切换，不新增独立“添加智能体”按钮，也不扩展 `/spaces/:id/members` 使其承担 Agent Grant 职责。

原因：

- 用户在一个入口完成所有成员管理，认知最简单。
- 复用现有 `GET /agents` 与 `PUT /agents/:agentId/grants/:spaceId`，避免重复后端模型。
- 保持 `SpaceMember` 表示人类成员、`AgentGrant` 表示智能体空间授权的清晰边界。

## 界面设计

“添加成员”弹窗顶部增加两个状态按钮：

- 用户：显示邮箱、角色以及原有添加按钮。
- 智能体：显示可选 Agent 列表、角色选择以及添加按钮。

智能体列表项显示名称和当前状态。列表只保留：

1. `ownerId` 为当前登录用户；
2. `status === active` 且 `revokedAt === null`；
3. 尚未出现在当前 Space 成员结果中的 Agent。

没有可用 Agent 时显示明确空状态，并提供前往“智能体”页面的入口。切换成员类型时清除上一次提交错误，不自动提交或保留不相干的表单字段。

## 默认权限

### 查看者

- `pages:read`
- `graph:read`

### 编辑者

- `pages:read`
- `pages:write`
- `sources:read`
- `graph:read`
- `graph:write`

添加后，管理员可在成员卡片展开权限设置，选择其他预设或逐项调整 12 个 Space 级权限。全局 Credential Scope 仍是上限，Space Grant 只能进一步收窄权限。

## 数据流

1. 打开弹窗时并行加载 Space 成员与 `GET /agents`。
2. 客户端过滤出当前用户可添加的 active Agent。
3. 用户选择 Agent 与 `viewer`/`editor`。
4. 客户端调用 `PUT /agents/:agentId/grants/:spaceId`，发送角色和对应默认 scopes。
5. 服务端继续使用现有 Space owner/admin 权限校验并创建或更新 `AgentGrant`。
6. 成功后关闭弹窗并刷新统一成员列表，Agent 以现有智能体卡片展示。

## 错误与边界

- Agent 列表加载失败：弹窗保留，显示本地化错误并允许重试。
- 没有可用 Agent：禁用添加按钮，显示空状态。
- Agent 在提交前已被撤销或暂停：服务端拒绝，客户端刷新候选列表。
- 调用者尝试通过猜测 ID 新增其他用户的 Agent：服务端拒绝且不泄露 Agent 详情。
- Agent 已被其他管理员同时添加：将成功后的 Grant 视为幂等结果，刷新成员列表。
- 非 owner/admin：不显示添加入口；服务端仍必须拒绝越权调用。
- 不向其他 Space 成员暴露当前用户未拥有的 Agent。

## 中英文与可访问性

- 所有新增文字同时提供中文和英文。
- 类型切换使用带可访问名称的状态按钮，并暴露当前选中状态。
- Agent 选择与角色选择使用原生表单控件和明确标签。
- 加载、错误和空状态可被辅助技术读取。

## 测试

客户端测试覆盖：

- 原有人类邮箱添加流程不回归；
- 只有当前用户拥有且 active、未加入 Space 的 Agent 可选；
- 查看者与编辑者提交正确的默认权限；
- 添加成功后刷新成员列表并关闭弹窗；
- Agent 列表加载失败、空列表和提交失败；
- owner/admin 可见入口，其他角色不可见；
- 中英文可访问名称。

服务端复用现有 Agent Grant 测试，补充必要回归：

- Space owner/admin 能为 active Agent 创建 Grant；
- 普通成员不能创建 Grant；
- 已撤销或不存在的 Agent 不能被添加；
- 重复添加保持幂等。

## 不做

- 不展示系统内所有 Agent。
- 不允许管理员搜索或添加其他用户尚未主动暴露的 Agent。
- 不让 Agent 获得 `owner` 或 `admin` 角色。
- 不新增数据库表或迁移。
- 不改变现有 Credential Scope、Space Grant 和 Space Policy 的权限交集规则。
