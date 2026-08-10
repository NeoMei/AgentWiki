# AgentWiki 功能测试指南 v0.2.8

> 面向测试人员的系统功能说明与按功能分类的测试用例清单
> 生产地址：https://agentwiki.quukk.com

---

## 一、系统架构概览

```
用户浏览器 ──→ https://agentwiki.quukk.com ──→ Nginx(8444) ──→ NestJS(3000) ──→ PostgreSQL
                                                      │
本地 Agent ──→ MCP(Streamable HTTP) ──────────────────┘
              API(agk_... Bearer Token)
```

**技术栈：** React/Vite 前端 + NestJS 后端 + Prisma/PostgreSQL + Redis 缓存/队列 + Socket.io 实时协作

**角色体系：**
- 平台角色（全局）：`super_admin`（超管）、`user`（普通用户）
- Space 角色：Owner → Admin → Editor → Viewer（权限递减）
- Agent 是独立实体，通过 Credential（agk_...）+ Space Grant 接入

---

## 二、功能模块与测试清单

### 模块 1：用户认证 `/api/auth`

| 序号 | 功能点 | API | 测试要点 |
|------|--------|-----|----------|
| 1.1 | 注册 | `POST /auth/register` | 合法邮箱+8位密码+名称→200；重复邮箱→409；弱密码(少于8位)→400；空名称→400；无效邮箱→400；连续注册触发限流→429 |
| 1.2 | 登录 | `POST /auth/login` | 正确凭据→200 返回 JWT；错误密码→401；锁定用户→401；删除用户→401 |
| 1.3 | 强制改密码 | `POST /auth/change-required-password` | 超管重置密码后，用户登录收到 `mustChangePassword:true`；受限 JWT 只能调此接口；新密码≠默认密码；密码>=8位；成功后返回正常 JWT |
| 1.4 | JWT 版本控制 | — | 密码重置/锁定/解锁后 `authVersion` 递增；旧 JWT 立即失效(401)；CombinedAuthGuard 和 JwtAuthGuard 均校验 authVersion |
| 1.5 | 速率限制 | — | 登录/注册连续失败触发 429；窗口过后恢复正常 |

**前端路由：** `/`（首页/登录卡片）、`/#login`（登录表单）、`/register`（注册）、`/change-password`（强制改密码页）

---

### 模块 2：Space 管理 `/api/spaces`

| 序号 | 功能点 | API | 测试要点 |
|------|--------|-----|----------|
| 2.1 | 创建 Space | `POST /spaces` | 名称→200；空名称→400 |
| 2.2 | 列出 Space | `GET /spaces` | 返回用户有权限的 Space 列表；未认证→401 |
| 2.3 | 查看 Space | `GET /spaces/:id` | 返回 Space 详情含角色；无权→403/404 |
| 2.4 | 编辑 Space | `PATCH /spaces/:id` | Owner/Admin 可编辑名称、审批策略等 |
| 2.5 | 删除 Space | `DELETE /spaces/:id` | 仅 Owner 可删除 |
| 2.6 | 成员列表 | `GET /spaces/:id/members` | 列出人类用户+Agent 成员，含角色和权限范围 |
| 2.7 | 添加成员 | `POST /spaces/:id/members` | 按邮箱添加人类用户；支持 Viewer/Editor 预设 |
| 2.8 | 添加 Agent 成员 | `PUT /agents/:id/grants/:spaceId` | 选择自己拥有的 active Agent；支持角色+Scope 预设；无权 Agent→404 |
| 2.9 | 编辑成员角色 | `PATCH /spaces/:id/members/:userId` | Admin 可升降成员角色 |
| 2.10 | 移除成员 | `DELETE /spaces/:id/members/:userId` | Admin 可移除成员（Owner 除外） |
| 2.11 | Owner 转移 | `PATCH /spaces/:id/members/:userId` | 仅 Owner 可转移；操作者降为 Admin；原子操作 |
| 2.12 | 审批策略 | — | `always-review`（默认）/ `scoped-auto-publish`（Agent+Space+Grant 三方许可时免审） |

**前端路由：** `/spaces/:id`（Space 视图）、`/spaces/:id/members`（成员管理）、`/spaces/:id/settings`（设置）

---

### 模块 3：页面 CRUD `/api/pages`

| 序号 | 功能点 | API | 测试要点 |
|------|--------|-----|----------|
| 3.1 | 创建页面 | `POST /pages` | spaceId+title+content→200；空标题→400；缺 spaceId→400 |
| 3.2 | 列出页面 | `GET /pages?spaceId=xxx` | 返回 Space 下所有页面；按层级和排序返回 |
| 3.3 | 查看页面 | `GET /pages/:id` | 返回内容+元数据+来源信息 |
| 3.4 | 编辑页面 | `PATCH /pages/:id` | 需 `expectedUpdatedAt` 乐观锁；版本冲突→409；支持编辑 content/parentId/title |
| 3.5 | 删除（归档） | `DELETE /pages/:id` | 软删除（设置 deletedAt）；内容保留 |
| 3.6 | 版本历史 | `GET /pages/:id/versions` | 列出所有版本快照 |
| 3.7 | 恢复版本 | `POST /pages/:id/versions/:vid/restore` | 恢复到指定版本；内容还原 |
| 3.8 | 层级树 | `GET /pages/hierarchy/:spaceId` | 返回树形结构（parentId 嵌套） |
| 3.9 | 重排序 | `PATCH /pages/reorder/:spaceId` | `{items: [{id, sortOrder, parentId}]}`；支持拖拽调整层级和顺序 |
| 3.10 | 乐观锁 | — | 并发更新：第二个更新者收到 409 冲突 |
| 3.11 | 循环检测 | — | 设置 parentId 时检测层级循环→400 |
| 3.12 | Wiki 链接 | — | `[[Page Name]]` 解析为内部链接；标题生成锚点 |
| 3.13 | 大载荷 | — | 超长内容(500KB+)→400/413，不返回 500 |

**前端路由：** `/pages/:id`（预览）、`/pages/:id/edit`（Obsidian 风格实时编辑，Edit/Preview 切换按钮，Ctrl/Cmd+E 快捷键）

---

### 模块 4：Agent 管理 `/api/agents`

| 序号 | 功能点 | API | 测试要点 |
|------|--------|-----|----------|
| 4.1 | 创建 Agent | `POST /agents` | name→200；用户只能创建自己的 Agent |
| 4.2 | 列出 Agent | `GET /agents` | 用户能看到自己的 Agent |
| 4.3 | 查看 Agent | `GET /agents/:id` | 含状态、审批模式、Grants、最近活动 |
| 4.4 | 编辑 Agent | `PATCH /agents/:id` | 可修改 name/description/approvalMode |
| 4.5 | 删除 Agent | `DELETE /agents/:id` | 撤销 Agent；凭据同步失效 |
| 4.6 | 创建凭据 | `POST /agents/:id/credentials` | name+scopes→200 返回 `apiKey`(agk_...)；key 仅显示一次 |
| 4.7 | 列出凭据 | `GET /agents/:id/credentials` | 显示前缀、scope、创建时间，不显示完整 key |
| 4.8 | 撤销凭据 | `DELETE /agents/:id/credentials/:cid` | 凭据立即失效→401 |
| 4.9 | Space 授权 | `PUT /agents/:id/grants/:spaceId` | role+scopes；空 scopes 继承凭据全部权限 |
| 4.10 | 撤销授权 | `DELETE /agents/:id/grants/:spaceId` | Agent 失去该 Space 访问权 |
| 4.11 | 活动记录 | `GET /agents/:id/activity` | 查看 Agent 的 MCP 调用和 API 活动 |
| 4.12 | 本地同步安装 | `POST /agents/:agentId/local-sync-installations` | 生成一次性安装码（10分钟过期） |
| 4.13 | 撤销安装 | `DELETE /agents/:agentId/local-sync-installations/:id` | 撤销安装码 |
| 4.14 | 安装码交换 | `POST /integrations/local-sync/exchange` | 用一次性码换取凭据（一次性使用） |

**前端路由：** `/agents`（Agent 列表）、`/agents/:id`（详情含凭证管理、接入指令生成）

---

### 模块 5：MCP 协议 `/api/mcp`

| 序号 | 功能点 | 工具名 | 测试要点 |
|------|--------|--------|----------|
| 5.1 | 初始化 | `initialize` | Streamable HTTP；Accept 头须含 `application/json, text/event-stream`；返回 serverInfo(name/version) |
| 5.2 | 列出 Space | `list_spaces` | 返回 Agent 授权访问的 Space 列表 |
| 5.3 | 列出页面 | `list_pages` | spaceId+分页(skip/take) |
| 5.4 | 读取页面 | `get_page` | pageId |
| 5.5 | 搜索页面 | `search_pages` | query+可选 spaceId+limit |
| 5.6 | 查看图谱 | `list_graph` | spaceId |
| 5.7 | 提议页面 | `propose_page` | spaceId+title+content；进入 ChangeSet 审查 |
| 5.8 | 提议关系 | `propose_relation` | 页面间知识关系 |
| 5.9 | 列出源 | `list_sources` | 知识来源列表 |
| 5.10 | 同步状态 | `get_knowledge_sync_state` | 本地同步状态查询 |
| 5.11 | 启动摄取 | `start_source_run` | 触发代码源扫描 |
| 5.12 | 召回记忆 | `recall_memory` | agentId+spaceId+query |
| 5.13 | 列出审查 | `list_reviews` | ChangeSet 列表 |
| 5.14 | 批准变更 | `approve_change_set` | Agent 禁止调用（仅人类用户） |
| 5.15 | 资源访问 | `agentwiki://spaces`、`agentwiki://pages/{pageId}` | MCP 资源协议 |
| 5.16 | Host 白名单 | — | `MCP_ALLOWED_HOSTS` 配置；自动包含 `PUBLIC_API_URL` 的 hostname |

---

### 模块 6：知识图谱 `/api/knowledge`

| 序号 | 功能点 | API | 测试要点 |
|------|--------|-----|----------|
| 6.1 | 创建关系 | `POST /knowledge/relations` | sourcePageId+targetPageId+relation+strength+confidence |
| 6.2 | 查看关系 | `GET /knowledge/relations/:pageId` | 返回 `{outgoing:[...], incoming:[...]}` |
| 6.3 | 关联页面 | `GET /knowledge/related/:pageId` | 返回双向关联的页面列表 |
| 6.4 | 删除关系 | `DELETE /knowledge/relations/:id` | 删除指定关系 |
| 6.5 | 更新强度 | `PATCH /knowledge/relations/:id/strength` | 修改关系强度 |
| 6.6 | 图谱数据 | `GET /knowledge/graph/:spaceId` | 返回节点+边数据供前端渲染 |

**前端路由：** `/spaces/:spaceId/graph`（可视化知识图谱）

---

### 模块 7：审查流程 `/api/review`

| 序号 | 功能点 | API | 测试要点 |
|------|--------|-----|----------|
| 7.1 | 审查列表 | `GET /review` | 列出待审/已审/已发布 ChangeSet |
| 7.2 | 查看变更 | `GET /change-sets/:id` | 含 items、审批记录、来源 Run |
| 7.3 | 审批单项 | `PATCH /change-sets/:id/items/:itemId` | 逐项 accept/reject |
| 7.4 | 提交审查 | `POST /change-sets/:id/submit` | draft→pending_review |
| 7.5 | 批准 | `POST /change-sets/:id/approve` | 全部 accepted→approved |
| 7.6 | 拒绝 | `POST /change-sets/:id/reject` | →rejected |
| 7.7 | 发布 | `POST /change-sets/:id/publish` | approved→published；写 knowledge revision |
| 7.8 | 一键审查发布 | `POST /change-sets/:id/review-publish` | 快审路径：接受全部 pending→批准→发布 |
| 7.9 | 回退 | `POST /change-sets/:id/revert` | 撤销已发布变更 |
| 7.10 | 自动发布 | — | Agent 创建内容时：Space `scoped-auto-publish` + Agent `scoped-auto-publish` + Grant 含 `review:auto-publish` → 跳过人工审查直接发布 |

**前端路由：** `/review`（审查队列，含状态徽章、快审按钮）

---

### 模块 8：代码源与摄取 `/api/spaces/:spaceId/sources`

| 序号 | 功能点 | API | 测试要点 |
|------|--------|-----|----------|
| 8.1 | 创建源 | `POST /spaces/:spaceId/sources` | name+type+uri |
| 8.2 | 文件上传 | `POST /spaces/:spaceId/sources/file` | 上传文件作为源 |
| 8.3 | 列出源 | `GET /spaces/:spaceId/sources` | Space 下所有源 |
| 8.4 | 查看源 | `GET /sources/:id` | 源详情 |
| 8.5 | 编辑源 | `PATCH /sources/:id` | — |
| 8.6 | 删除源 | `DELETE /sources/:id` | — |
| 8.7 | 启动摄取 | `POST /sources/:id/runs` | 创建 Run；Redis 队列处理 |
| 8.8 | 列出 Run | `GET /spaces/:spaceId/runs` | — |
| 8.9 | 查看 Run | `GET /runs/:id` | Run 状态+Evidence |
| 8.10 | 重试 | `POST /runs/:id/retry` | — |
| 8.11 | 取消 | `POST /runs/:id/cancel` | — |

**前端路由：** `/spaces/:id/sources`（源管理）、`/spaces/:id/runs`（摄取运行记录）

---

### 模块 9：搜索 `/api/search`

| 序号 | 功能点 | API | 测试要点 |
|------|--------|-----|----------|
| 9.1 | 语义搜索 | `GET /search?q=xxx` | embedding 向量搜索；fallback 文本搜索 |
| 9.2 | Space 搜索 | `GET /search?q=xxx&spaceId=xxx` | 限 Space 范围 |
| 9.3 | 索引 | `POST /search/index/:pageId` | 重建单页索引 |

**前端路由：** `/search`（搜索结果页）

---

### 模块 10：Agent Memory `/api/agents/:agentId/memories`

| 序号 | 功能点 | API | 测试要点 |
|------|--------|-----|----------|
| 10.1 | 写入记忆 | `POST` | type+content+scope(space/agent/page) |
| 10.2 | 列出记忆 | `GET` | 分页列表 |
| 10.3 | 召回记忆 | `POST .../recall` | query 语义召回 |
| 10.4 | 整理记忆 | `POST .../consolidate` | — |
| 10.5 | 归档记忆 | `POST .../:id/archive` | — |
| 10.6 | 删除记忆 | `DELETE .../:id` | — |

---

### 模块 11：平台管理后台 `/api/platform-admin`

| 序号 | 功能点 | API | 测试要点 |
|------|--------|-----|----------|
| 11.1 | 统计概览 | `GET /platform-admin/stats` | users.total/active/locked/deleted/new7d/new30d；spaces；pages；agents；30天趋势；最近用户 |
| 11.2 | 用户列表 | `GET /platform-admin/users` | 搜索(姓名/邮箱)、状态筛选(active/locked/deleted)、角色筛选、分页；每用户含 Space/Agent 计数 |
| 11.3 | 重置密码 | `POST /platform-admin/users/:id/reset-password` | 生成随机一次性临时密码→mustChangePassword=true→authVersion++→撤销个人/Agent 凭据；临时密码仅当次显示 |
| 11.4 | 锁定用户 | `POST /platform-admin/users/:id/lock` | lockedAt 设置→JWT/PAT/Agent 凭据全部失效；已锁定→幂等；已删除→拒绝 |
| 11.5 | 解锁用户 | `POST /platform-admin/users/:id/unlock` | lockedAt 清除→PAT 和 Agent 凭据恢复；旧 JWT 不恢复 |
| 11.6 | 软删除 | `DELETE /platform-admin/users/:id` | 设置 deletedAt→认证永久失效；内容和关联保留 |
| 11.7 | 自我保护 | — | 超管不能操作自己→409 |
| 11.8 | 最后超管保护 | — | 不能锁定/删除最后一个 active 超管→409 |
| 11.9 | 事务保护 | — | lock/delete 操作在 $transaction 中执行，防止竞态条件 |
| 11.10 | 权限隔离 | — | 普通用户访问→403；Agent 访问→401；未认证→401 |
| 11.11 | 超管入口 | — | 右上角用户菜单增加"平台管理"入口（仅 super_admin 可见） |

**前端路由：** `/admin`（仅 super_admin 可访问，含统计卡片、趋势图、用户管理表格、操作确认弹窗）

---

### 模块 12：本地知识同步 `/api/integrations/local-sync`

| 序号 | 功能点 | 测试要点 |
|------|--------|----------|
| 12.1 | 安装码生成 | Agent 详情页→输入 Agent 名称→生成一次性接入指令 |
| 12.2 | 本地安装 | 将指令粘贴到 Codex/Claude Code/OpenCode→自动安装 MCP 连接和 Skill |
| 12.3 | Doctor 检查 | `agentwiki-local-sync doctor` 验证连接、Adapter、权限 |
| 12.4 | 扫描预览 | 扫描本地目录→本地预览→不自动上传 |
| 12.5 | 确认同步 | 用户明确确认后上传到 AgentWiki |
| 12.6 | 跨机器同步 | 不同机器通过同一 Space 读写同一套 Wiki |
| 12.7 | 知识修订 | `GET /spaces/:spaceId/knowledge-revisions/current` 返回当前 revision |
| 12.8 | 快照/Delta | `GET .../snapshot`、`GET .../delta?from=xxx` 增量同步 |
| 12.9 | npm 包 | 发布后 `npm view @neomei/agentwiki-local-sync version` 必须为 `0.2.8`；发布前不将暂存版冒充为公网版 |

---

### 模块 13：AI 辅助写作

| 序号 | 功能点 | 测试要点 |
|------|--------|----------|
| 13.1 | 提交任务 | `POST /assist/tasks` → 服务端 OpenCode 处理 |
| 13.2 | 查询任务 | `GET /assist/tasks`、`GET /assist/tasks/:id` |
| 13.3 | 模型降级 | 免费模型优先→付费模型自动发现→成本排序→失败降级 |
| 13.4 | Redis 熔断 | 连续失败 3 次→熔断 2 分钟；共享熔断状态 |
| 13.5 | 成本记录 | 每次调用记录 model/cost/tokens |

**前端：** 页面编辑时侧边 Agent 辅助面板

---

### 模块 14：国际化 & 导航

| 序号 | 功能点 | 测试要点 |
|------|--------|----------|
| 14.1 | 中英文切换 | 所有页面文案切换；浏览器持久化语言选择 |
| 14.2 | 全局导航 | 首页/使用指南/工作台三个入口始终可达；Logo 返回首页 |
| 14.3 | 登录意图 | 未登录访问工作台→跳转登录卡片并自动聚焦邮箱 |
| 14.4 | 移动端 | 390×844 响应式布局无横向溢出 |

---

### 模块 15：实时协作（WebSocket）

| 序号 | 功能点 | 测试要点 |
|------|--------|----------|
| 15.1 | 加入页面 | `joinPage` → 用户加入编辑会话 |
| 15.2 | 光标同步 | `cursorMove` → 其他用户看到光标位置 |
| 15.3 | 内容同步 | `contentChange` → 实时编辑传播 |
| 15.4 | 离开页面 | `leavePage` → 退出会话 |

---

## 三、权限矩阵

| 操作 | Owner | Admin | Editor | Viewer | Agent |
|------|-------|-------|--------|--------|-------|
| 删除 Space | ✅ | ❌ | ❌ | ❌ | ❌ |
| 管理成员 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 创建/编辑页面 | ✅ | ✅ | ✅ | ❌ | ✅(审查后) |
| 删除页面 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 查看页面 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 创建关系 | ✅ | ✅ | ✅ | ❌ | ✅(审查后) |
| 管理源 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 启动摄取 | ✅ | ✅ | ✅ | ❌ | ✅(审查后) |
| 审批变更 | ✅ | ✅ | ✅(仅自己Space) | ❌ | ❌ |

**Agent 自动发布条件（三者同时满足）：**
1. Space `approvalPolicy` = `scoped-auto-publish`
2. Agent `approvalMode` = `scoped-auto-publish`
3. Agent Grant 含 `review:auto-publish` scope

---

## 四、快速冒烟测试脚本

```bash
# 在仓库根目录运行；默认只允许测试本机服务
AGENTWIKI_SMOKE_E2E=1 pnpm test:e2e:smoke
AGENTWIKI_CROSS_MACHINE_E2E=1 pnpm test:e2e:cross-machine
AGENTWIKI_SPACE_AGENT_UI_E2E=1 pnpm test:e2e:space-agent-ui
AGENTWIKI_UI_ROUTE_E2E=1 pnpm test:e2e:ui-routes
```

如需对远程环境执行会创建数据的 E2E，必须同时显式设置 `<SUITE>_ALLOW_REMOTE=1`
和 `<SUITE>_CONFIRM_HOST=<精确域名>`。脚本只使用一次性用户、Space 和 Agent，并在 `finally`
中清理全部测试数据。
