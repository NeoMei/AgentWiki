# 协作运行内准备并接入 Agent 设计

**日期：** 2026-08-25
**状态：** 已确认，等待书面复核
**适用范围：** Agent 协作运行三步启动向导的“2. 映射 Agent”步骤

## 背景与根因

运行向导目前只从当前 Space 成员接口中选择满足以下条件的 Agent：

- 已经拥有当前 Space 的 `AgentGrant`；
- Agent 处于 `active`；
- Grant 角色为 `editor` 或 `publisher`，因而拥有 `collaboration:execute`。

生产现场中，当前 Space 虽有一个 active Agent，但 Grant 为 `reader`；其余 Agent 均为 paused。因此映射列表为空。现有界面只显示“当前空间没有已授权的活跃可执行 Agent”，没有创建、恢复、升级授权或生成接入指令的入口。用户即使离开向导创建 Agent，仍需继续完成 Space 授权和 MCP 接入，无法一次完成协作准备。

## 目标

在不离开运行向导的前提下，让有权限的用户完成以下闭环：

1. 选择已有 Agent，或创建新 Agent；
2. 必要时恢复 paused Agent；
3. 为当前 Space 授予可执行的 Editor 或 Publisher 角色；
4. 复用已有的当前 Space 有效连接，或生成一次性 MCP 接入指令；
5. 检测接入结果；
6. 刷新可执行 Agent 列表，并把准备完成的 Agent 映射到当前 Role Slot。

## 不做

- 不自动创建或启动 Codex、Claude Code、OpenCode 等外部 Agent 进程；用户仍需把接入指令交给目标 Agent。
- 不修改协作模板结构、Task/Todo、调度算法或运行状态机。
- 不新增第二套权限、Credential scopes 或授权入口。
- 不把一个新 Agent 自动映射到全部 Role Slot。
- 不在本任务中自动发布到 GitHub、npm 或生产服务器。

## 方案比较

### 方案一：前端编排现有 API（采用）

由新的准备弹窗按阶段调用既有 Agent 创建、状态更新、Grant 幂等更新、Local Sync 安装意图和 Agent 详情接口。优点是核心权限模型与接入协议不变、改动集中、可复用已验证的接入链路。缺点是多个阶段不能跨 PostgreSQL 与 Redis 做全局原子提交，因此界面必须显式处理部分成功和阶段重试。复用检查发现 Local Sync installation 接口尚未像协作与 Grant 接口一样识别平台 Super Admin；实施时只对齐这一处既有权限契约，不新增聚合端点。

### 方案二：新增后端聚合接口

新增“准备协作 Agent”端点统一编排创建、恢复、授权和安装码。调用面更整齐，但数据库事务与 Redis 安装意图仍无法真正原子提交，还会扩大 API、DTO、权限和审计范围，不能消除方案一需要处理的部分成功状态。

### 方案三：跳转到 Agent 管理页面再返回

继续使用 Agent 列表、Agent 详情和 Space 成员页面。实现量最小，但会中断草稿向导，用户仍需在多个页面间往返，直接违背“一次完成”的目标。

## 交互结构

### 映射步骤

“2. 映射 Agent”保留现有 Role Slot 下拉框，每个 Role Slot 卡片增加次级“准备 Agent”入口，并把该 Role Slot ID 作为弹窗目标。没有可执行 Agent 时，额外显示“准备第一个 Agent”主操作，目标为第一个尚未映射的必需 Role Slot。这样准备完成后的自动选择始终有唯一、可解释的目标。

入口打开 `AgentPreparationDialog`。弹窗有两个清晰模式：

1. **使用已有 Agent**：列出当前用户拥有且未撤销的 Agent，并展示 active/paused、当前 Space 角色和连接状态。
2. **创建新 Agent**：填写名称和可选描述，选择 Editor 或 Publisher；默认 Editor，以最小权限满足协作执行。

Reader 会明确提示授权将升级为 Editor 或 Publisher；paused Agent 会明确提示先恢复。用户提交前能够看到将发生的状态和权限变化。

### MCP 接入

Agent 已具备当前 Space 的有效连接时，跳过安装码生成，直接刷新并完成映射。

没有有效连接时，弹窗生成十分钟有效的一次性接入指令，并显示：

- 完整接入指令；
- 一键复制；
- 有效期倒计时；
- 等待接入、接入成功或已过期状态；
- 过期或生成失败后的原位重试。

弹窗打开且安装码有效时，客户端限时检查 Agent 详情中的当前 Space 有效连接。检测到接入成功后，刷新 Space 成员列表，并把该 Agent 自动选入用户发起准备操作时对应的 Role Slot。

用户可选择“稍后接入，先完成映射”。此时 Agent 已因 Grant 成为可映射对象，但映射步骤和确认步骤必须保留清晰的“尚未接入”提示，不能暗示其已能通过 MCP 领取任务。运行仍允许先启动再等待 Agent 接入，沿用现有运行模型；用户必须在确认步骤明确看到哪些已映射 Agent 尚未连接。

### 多角色

每次准备只填入当前 Role Slot，不自动覆盖其他映射，也不自动把同一个 Agent 分配给所有角色。用户可以重复打开入口，连续准备多个 Agent。既有的同 Agent 多角色自审风险确认保持不变。

## 权限模型

- Space Owner、Admin 和平台 Super Admin 可以创建、恢复并授权自己拥有的 Agent。
- Space Editor 可以创建和启动协作运行，但不能管理 Agent Grant。没有可执行 Agent 时，界面说明需要 Owner/Admin 准备 Agent，不展示最终必然返回 403 的可操作流程。
- Space Viewer 不能启动运行，现有协作入口权限保持不变。
- `AgentGrant.role` 继续作为唯一持久化权限事实。
- Credential 只保存连接身份与生命周期，执行权限继续从当前 Grant 实时派生。
- Agent 仍然没有人类审核、成员管理或 `review:decide` 权限。
- 现有 Local Sync installation 服务只按显式 Space membership 判断发码权限，尚未接收平台角色。实施必须让 Controller 将 Super Admin 身份传入既有检查，并以服务端测试证明其与协作和 Grant 端点的 Super Admin 规则一致；普通用户规则不放宽。

## 数据流

### 初始化

运行向导继续并行读取模板和 Space 成员。它从人类成员记录和当前登录用户平台角色推导 `canPrepareAgents`；平台 Super Admin 视为 Owner，其余用户只在当前 Space 人类角色为 Owner/Admin 时可准备。向导从 Agent Grant 记录构造可执行 Agent 列表。

准备弹窗按需读取当前用户拥有的 Agent；只在打开时加载，避免扩大每次向导初始化成本。选中某个 Agent 后再读取详情，以确定当前 Space 是否已有有效 Credential。

### 准备已有 Agent

按需要执行以下阶段：

1. paused Agent 调用状态更新接口恢复为 active；
2. 使用现有幂等 Grant 接口把当前 Space 角色更新为 Editor 或 Publisher；
3. 读取 Agent 详情，查找 `authorization.space.id` 等于当前 Space 且未撤销、未过期的连接；
4. 若存在有效连接，刷新成员并完成映射；
5. 若不存在，创建 Local Sync installation intent 并进入等待接入状态。

### 准备新 Agent

1. 创建 Agent；
2. 为当前 Space 幂等授予 Editor 或 Publisher；
3. 创建 Local Sync installation intent；
4. 等待接入或允许稍后接入；
5. 刷新成员并完成当前 Role Slot 映射。

### 完成接入

外部 Agent 使用一次性指令兑换连接后，既有服务端流程会把 Credential 绑定到同一 `AgentGrant`。前端检测到当前 Space 的有效 Credential 后停止检查、刷新权威成员状态并更新映射。

## 状态与并发

弹窗显式维护以下状态，而不是用一个通用 loading 覆盖全部阶段：

- `selecting`
- `creating`
- `activating`
- `granting`
- `checking_connection`
- `issuing_instruction`
- `waiting_connection`
- `connected`
- `partially_ready`
- `failed`

提交期间禁止重复操作。路由、Space、template 或目标 Role Slot 改变时递增请求 epoch；旧响应不得覆盖新向导。弹窗关闭后停止轮询和倒计时。重复 Grant 更新依靠现有 upsert 保持幂等。

## 部分成功与错误处理

- 创建、恢复或 Grant 更新失败时停留在对应阶段，并展示阶段化错误。
- Agent 与 Grant 已成功、安装码生成失败时，不删除 Agent、不降级 Grant；进入 `partially_ready`，只重试安装码。
- 安装码过期后只重新创建 installation intent。
- 成员刷新失败时保留已准备 Agent 的标识并提供刷新重试，不重复创建或授权。
- 权限在流程中发生变化并返回 403 时，重新读取成员权限，切换为联系 Owner/Admin 的说明。
- 接入检测暂时失败时不宣告安装失败；保留最后一次权威状态并允许手动刷新。
- 一次性接入指令不写入 `localStorage`，不进入持久化运行草稿，不出现在通用错误、日志或分析事件中。

## 组件边界

- `RunStartWizard`：负责步骤、运行草稿、可执行 Agent 和 Role Slot 映射。
- `RoleBindingEditor`：继续作为纯映射组件，只通过 `onPrepare(roleSlotId)` 上报用户操作，不承担 Agent 生命周期与授权。
- `AgentPreparationDialog`：负责选择/创建、恢复、授权和接入编排，通过 `onPrepared(agent, targetRoleSlotId, connectionState)` 回传结果。
- 连接状态区块：负责一次性指令、复制、倒计时、轮询结果和重试，可在后续其他 Agent 接入场景复用。
- API 封装使用有类型的 Agent 方法，避免在 UI 组件中散落裸路径和 `any`。

界面继续复用项目现有 React、Tailwind、`ModalDialog`、Toast 和图标体系，不引入第二套组件库。所有新增文案进入共享中英文消息表。

## 可访问性与响应式

- 弹窗复用现有焦点约束、Escape 关闭和标题关联能力。
- 异步进度使用 `role=status`，可恢复错误使用 `role=alert`。
- 每个 Agent、角色选择、复制和重试操作有可识别名称。
- 桌面端可以使用紧凑的分区布局；390px 下改为单列堆叠，按钮允许换行或占满宽度。
- 长接入指令必须断行并限制高度，不能造成横向页面溢出。

## 测试策略

### 组件与向导测试

按 TDD 添加至少以下行为测试：

- 无可执行 Agent 的 Owner/Admin 看到主入口；
- Editor 看到联系 Owner/Admin 的准确说明，且没有不可用的授权操作；
- active Reader 升级为 Editor、刷新后可选并映射；
- paused Agent 恢复、授权并继续；
- 新 Agent 创建、Grant、安装指令生成和当前 Role Slot 自动选择；
- 已有当前 Space 有效 Credential 时不重复生成安装码；
- 安装码过期、生成失败、检测失败和成员刷新失败分别可恢复；
- 部分成功后重试不会重复创建 Agent；
- 双击提交、关闭弹窗和跨 template/Space 导航不会产生旧响应覆盖；
- “稍后接入”会留下未连接提示；
- 未连接提示同时出现在映射和确认步骤，运行可以在明确提示后先启动；
- 中英文文案和基本可访问性语义存在。

### 回归与真实验收

- Client focused tests、全量 tests、lint、typecheck、build 和 `git diff --check`。
- 为 Local Sync installation 的 Super Admin 权限对齐增加 Controller/Service RED→GREEN 测试；除此之外不无故扩大后端。
- 使用隔离测试数据完成真实创建 Agent、授权、生成安装指令、Local Sync onboard 兑换、自动检测、映射和启动运行。
- 在桌面和 390px 移动视口验证空状态、弹窗、长指令、错误恢复和无横向溢出。
- 检查浏览器控制台无值得修复的 error/warn。
- 生产只做只读复现；发布、生产写入与线上验收必须另获授权。

## 验收标准

1. 映射步骤无可执行 Agent 时存在明显且权限正确的准备入口。
2. active Reader、paused Agent、未授权 Agent 和新 Agent 都能在授权边界内完成准备。
3. 新 Agent 能在同一向导内获得当前 Space Grant 和一次性 MCP 接入指令。
4. 外部 Agent 接入后，页面自动识别有效连接并选中正确 Role Slot。
5. 部分成功、过期、网络错误、权限变化和重复操作不会产生重复 Agent、错误回滚或陈旧 UI。
6. 未接入 Agent 不会被界面误报为已经可以领取任务。
7. 现有三步启动、服务端执行预检、自审风险确认和运行启动行为保持通过。
8. 中英文、键盘语义、桌面和 390px 移动端验收通过。
