# AgentWiki 工程开发手册

> 目的：确保自研过程中每个细节都有据可查，避免"自研陷阱"（需求不清、细节覆盖不够）
> 核心原则：每个工程决策必须链接到参考实现，每个实现细节必须可追溯到参考代码

---

## 目录

1. [工程决策地图](#1-工程决策地图)
2. [实现细节对照表](#2-实现细节对照表)
3. [开发步骤与里程碑](#3-开发步骤与里程碑)
4. [未知问题处理流程](#4-未知问题处理流程)
5. [参考项目索引](#5-参考项目索引)

---

## 1. 工程决策地图

### 1.1 技术栈决策

| 技术选型 | 决策 | 参考项目 | 参考位置 | 自研差异 | 决策理由 |
|---------|------|---------|---------|---------|---------|
| 后端框架 | NestJS | Docmost | apps/server/src/app.module.ts | 增加 Agent 模块 | 成熟、模块化、TypeScript 原生 |
| 前端框架 | React + Vite | Docmost | apps/client/src/App.tsx | 增加图谱视图 | 与 Docmost 一致，降低迁移成本 |
| 数据库 | PostgreSQL + pgvector | Docmost | apps/server/src/database/ | 增加图模型表 | Docmost 已验证的 Schema 设计 |
| ORM | Prisma | Docmost | 全局 | 增加图关系模型 | 类型安全、迁移方便 |
| 协作编辑 | Yjs CRDT | Docmost | apps/server/src/collaboration/ | 增加 Agent awareness | 无锁、最终一致，已验证 |
| 编辑器 | TipTap 2.x | Docmost | packages/editor-ext/ | 增加 Frontmatter 支持 | 基于 ProseMirror，可扩展 |
| 图谱可视化 | Cytoscape.js | 自研 | - | 4层图模型渲染 | 参考项目无此功能 |
| 认证 | Passport + JWT | Docmost | apps/server/src/core/auth/ | 增加 API Key 认证 | 人类认证复用，Agent 认证新增 |
| 搜索 | PostgreSQL FTS + pgvector | Docmost | apps/server/src/core/search/ | 增加语义搜索 | 个人规模无需 Elasticsearch |
| 文件存储 | S3/本地抽象 | Docmost | apps/server/src/integrations/ | 复用 | 已验证的存储抽象 |

### 1.2 核心功能决策

| 功能 | 复杂度 | 参考项目 | 实现策略 | 关键细节 |
|------|--------|---------|---------|---------|
| 用户认证 (OAuth2/SSO) | 中等 | Docmost | **复用改造** | 复用 Docmost 认证模块，增加 Agent API Key 认证 |
| 多用户协作编辑 | 高 | Docmost | **复用改造** | 复用 Yjs 集成，增加 Agent 编辑冲突检测 |
| 权限系统 (RBAC) | 高 | Docmost | **复用改造** | 复用空间/页面级权限，增加 Agent 权限维度 |
| Markdown + Frontmatter 编辑 | 高 | Docmost | **扩展** | 复用 TipTap 编辑器，增加 YAML Frontmatter 解析 |
| 文件上传/管理 | 中等 | Docmost | **复用** | 直接使用 Docmost 存储抽象 |
| 全文搜索 | 中等 | Docmost | **复用改造** | 复用 PostgreSQL FTS，增加向量搜索 |
| 评论/讨论 | 中等 | Docmost | **复用** | 直接使用 Docmost 评论系统 |
| **Agent 认证 (API Key)** | **中等** | **Outline** | **新增** | 参考 Outline API Key 设计，实现 Agent 专用认证 |
| **知识图谱 (4层图模型)** | **极高** | **SwarmVault** | **新增** | 参考 SwarmVault 图模型，实现 4层知识图谱 |
| **摄取/编译引擎** | **极高** | **SwarmVault** | **新增** | 参考 Karpathy 模式，实现文档摄取和知识编译 |
| **Agent 记忆系统 (4层)** | **极高** | **Mnemon** | **新增** | 参考 Mnemon 记忆模型，实现 Agent 持久记忆 |
| **MCP Server** | **中等** | **Mnemon** | **新增** | 参考 Mnemon MCP 设计，实现 AgentWiki MCP |
| **Agent 审批工作流** | **中等** | **自研** | **新增** | 无直接参考，需结合 RBAC 设计 |
| **图谱可视化** | **高** | **自研** | **新增** | 参考 Cytoscape.js 文档，实现 4层图渲染 |

### 1.3 本地运行时基线

- AgentWiki 仅支持 Node.js 26，不再兼容 Node 20/22/24；仓库通过 `.node-version` 和 `package.json#engines` 统一约束为 `>=26 <27`。
- 包管理器固定为 pnpm 11.9.0，安装时使用 `pnpm install --frozen-lockfile`。
- 开发时在 `agentwiki/` 目录直接执行 `pnpm dev`；统一启动器会加载根 `.env`、补齐 `JWT_SECRET` 映射，并监督 API、Worker 和 Vite 三个子进程。
- 前端 Vitest worker 显式禁用 Node 26 的实验性全局 Web Storage，测试使用 jsdom 自己的隔离存储。

---

## 2. 实现细节对照表

### 2.1 认证模块

| 需求 | 参考实现 | 代码位置 | 自研差异 | 决策记录 |
|------|---------|---------|---------|---------|
| OAuth2 登录 | Docmost | apps/server/src/core/auth/ | 复用 | 2026-07-03: 直接复用 |
| JWT Token 管理 | Docmost | apps/server/src/core/auth/ | 复用 | 2026-07-03: 直接复用 |
| 会话管理 | Docmost | apps/server/src/core/auth/ | 复用 | 2026-07-03: 直接复用 |
| **API Key 认证** | Outline | server/routes/api/ | 新增 Agent 专用 | 2026-07-03: 参考 Outline API Key 模式 |
| **Agent 权限维度** | 无 | - | 新增 | 2026-07-03: 基于 RBAC 扩展 |

### 2.2 协作编辑模块

| 需求 | 参考实现 | 代码位置 | 自研差异 | 决策记录 |
|------|---------|---------|---------|---------|
| Yjs WebSocket 服务器 | Docmost | apps/server/src/collaboration/ | 复用 | 2026-07-03: 直接复用 |
| CRDT 文档同步 | Docmost | apps/server/src/collaboration/ | 复用 | 2026-07-03: 直接复用 |
| 光标/选区同步 | Docmost | apps/server/src/collaboration/ | 复用 | 2026-07-03: 直接复用 |
| **Agent 编辑 Awareness** | 无 | - | 新增 | 2026-07-03: 在 Yjs awareness 中增加 Agent 标识 |
| **Agent 编辑冲突检测** | 无 | - | 新增 | 2026-07-03: 人类编辑优先，Agent 编辑入队列 |
| **Agent 批量编辑队列** | 无 | - | 新增 | 2026-07-03: 串行化处理，避免冲突 |

### 2.3 权限模块

| 需求 | 参考实现 | 代码位置 | 自研差异 | 决策记录 |
|------|---------|---------|---------|---------|
| 空间级 RBAC | Docmost | apps/server/src/core/workspace/ | 复用 | 2026-07-03: 直接复用 |
| 页面级权限 | Docmost | apps/server/src/core/page/ | 复用 | 2026-07-03: 直接复用 |
| 角色定义 | Docmost | apps/server/src/database/ | 复用 | 2026-07-03: 直接复用 |
| **Agent 角色** | 无 | - | 新增 | 2026-07-03: 增加 Agent 角色类型 |
| **Agent 权限边界** | 无 | - | 新增 | 2026-07-03: 限制 Agent 只能编辑指定页面 |
| **审批流程** | 无 | - | 新增 | 2026-07-03: 敏感操作需人工审批 |

### 2.4 编辑器模块

| 需求 | 参考实现 | 代码位置 | 自研差异 | 决策记录 |
|------|---------|---------|---------|---------|
| TipTap 编辑器 | Docmost | packages/editor-ext/ | 复用 | 2026-07-03: 直接复用 |
| Markdown 序列化 | Docmost | packages/editor-ext/ | 复用 | 2026-07-03: 直接复用 |
| Slash 命令 | Docmost | packages/editor-ext/ | 复用 | 2026-07-03: 直接复用 |
| **YAML Frontmatter** | 无 | - | 新增 | 2026-07-03: 页面元数据存储 |
| **Frontmatter 编辑器** | 无 | - | 新增 | 2026-07-03: 表单式 Frontmatter 编辑 |
| **页面类型系统** | 无 | - | 新增 | 2026-07-03: 概念页、任务页、参考页等 |

### 2.5 知识图谱模块

| 需求 | 参考实现 | 代码位置 | 自研差异 | 决策记录 |
|------|---------|---------|---------|---------|
| **4层图模型** | SwarmVault | packages/engine/ | 适配 | 2026-07-03: 参考 SwarmVault 图模型设计 |
| **图数据库存储** | 无 | - | 新增 | 2026-07-03: PostgreSQL + 邻接表实现 |
| **图谱渲染** | 无 | - | 新增 | 2026-07-03: Cytoscape.js 实现 4层渲染 |
| **图遍历算法** | Mnemon | docs/design/04-graph-model.md | 适配 | 2026-07-03: 参考 Mnemon 图遍历 |
| **关系类型定义** | SwarmVault | templates/llm-wiki-schema.md | 适配 | 2026-07-03: 定义 AgentWiki 关系类型 |

### 2.6 摄取/编译引擎

| 需求 | 参考实现 | 代码位置 | 自研差异 | 决策记录 |
|------|---------|---------|---------|---------|
| **文档摄取管道** | SwarmVault | packages/engine/ | 适配 | 2026-07-03: 参考 SwarmVault 摄取流程 |
| **知识提取** | SwarmVault | packages/engine/ | 适配 | 2026-07-03: LLM 提取概念、关系 |
| **知识编译** | SwarmVault | packages/engine/ | 适配 | 2026-07-03: 日日志 → 知识文章 |
| **索引构建** | SwarmVault | packages/engine/ | 适配 | 2026-07-03: 结构化索引，非 RAG |
| **摄取任务队列** | 无 | - | 新增 | 2026-07-03: 异步处理，状态跟踪 |

### 2.7 Agent 记忆系统

| 需求 | 参考实现 | 代码位置 | 自研差异 | 决策记录 |
|------|---------|---------|---------|---------|
| **4层记忆模型** | Mnemon | docs/design/03-concepts.md | 适配 | 2026-07-03: 参考 Mnemon 记忆分层 |
| **记忆衰减算法** | Mnemon | docs/design/ | 适配 | 2026-07-03: 参考 Mnemon 衰减策略 |
| **记忆检索** | Mnemon | docs/design/ | 适配 | 2026-07-03: 图遍历 + 语义搜索 |
| **记忆注入** | Mnemon | docs/harness/ | 适配 | 2026-07-03: 会话开始时注入相关记忆 |
| **Agent 记忆隔离** | 无 | - | 新增 | 2026-07-03: 每个 Agent 独立记忆空间 |

### 2.8 MCP Server

| 需求 | 参考实现 | 代码位置 | 自研差异 | 决策记录 |
|------|---------|---------|---------|---------|
| **MCP 协议实现** | Mnemon | harness/ | 适配 | 2026-07-03: 参考 Mnemon MCP 设计 |
| **工具注册** | Mnemon | harness/ | 适配 | 2026-07-03: AgentWiki 专用工具 |
| **资源暴露** | Mnemon | harness/ | 适配 | 2026-07-03: 知识库作为 MCP 资源 |
| **提示词模板** | Mnemon | harness/ | 适配 | 2026-07-03: AgentWiki 上下文注入 |

---

## 3. 开发步骤与里程碑

### 里程碑 1：基础平台（Week 1-2）
**目标**：可运行的 Wiki 平台，支持基本 CRUD

| 步骤 | 任务 | 参考项目 | 参考代码 | 验收标准 |
|------|------|---------|---------|---------|
| 1.1 | 环境搭建 | Docmost | docker-compose.yml | Docker 启动，PostgreSQL + Redis 运行 |
| 1.2 | 后端脚手架 | Docmost | apps/server/src/app.module.ts | NestJS 启动，健康检查通过 |
| 1.3 | 前端脚手架 | Docmost | apps/client/src/App.tsx | Vite 启动，首页渲染 |
| 1.4 | 数据库 Schema | Docmost | apps/server/src/database/ | Prisma 迁移成功，基础表创建 |
| 1.5 | 用户认证 | Docmost | apps/server/src/core/auth/ | 注册/登录/登出功能正常 |
| 1.6 | 空间管理 | Docmost | apps/server/src/core/workspace/ | 创建/删除空间，成员管理 |
| 1.7 | 页面 CRUD | Docmost | apps/server/src/core/page/ | 创建/编辑/删除页面 |
| 1.8 | Markdown 编辑器 | Docmost | packages/editor-ext/ | TipTap 编辑器正常运行 |

### 里程碑 2：协作与权限（Week 3-4）
**目标**：支持多人协作编辑，完善权限系统

| 步骤 | 任务 | 参考项目 | 参考代码 | 验收标准 |
|------|------|---------|---------|---------|
| 2.1 | Yjs 集成 | Docmost | apps/server/src/collaboration/ | 多用户实时编辑，光标同步 |
| 2.2 | 权限系统 | Docmost | apps/server/src/core/ | RBAC 权限控制正常 |
| 2.3 | 页面级权限 | Docmost | apps/server/src/core/page/ | 页面访问控制正常 |
| 2.4 | 搜索功能 | Docmost | apps/server/src/core/search/ | 全文搜索正常工作 |
| 2.5 | 文件上传 | Docmost | apps/server/src/integrations/ | 文件上传/下载正常 |
| 2.6 | 评论系统 | Docmost | apps/server/src/core/ | 页面评论功能正常 |

### 里程碑 3：Agent 基础（Week 5-6）
**目标**：Agent 可以认证、编辑页面

| 步骤 | 任务 | 参考项目 | 参考代码 | 验收标准 |
|------|------|---------|---------|---------|
| 3.1 | API Key 认证 | Outline | server/routes/api/ | Agent 通过 API Key 认证 |
| 3.2 | Agent 管理界面 | 自研 | - | Agent CRUD 界面完成 |
| 3.3 | Agent 编辑 API | Docmost + 自研 | apps/server/src/core/page/ | Agent 可以编辑页面 |
| 3.4 | Agent 编辑冲突 | 自研 | - | 人类编辑优先，Agent 入队列 |
| 3.5 | 编辑审批流程 | 自研 | - | 敏感操作需审批 |
| 3.6 | Agent 日志 | 自研 | - | Agent 操作记录完整 |

### 里程碑 4：知识图谱（Week 7-8）
**目标**：4层知识图谱建立，可视化呈现

| 步骤 | 任务 | 参考项目 | 参考代码 | 验收标准 |
|------|------|---------|---------|---------|
| 4.1 | 图数据库设计 | SwarmVault | packages/engine/ | 图模型表创建 |
| 4.2 | 4层图模型实现 | SwarmVault | templates/llm-wiki-schema.md | 概念/连接/QA/元数据层 |
| 4.3 | 图谱渲染 | 自研 | - | Cytoscape.js 渲染 4层图 |
| 4.4 | 图遍历算法 | Mnemon | docs/design/04-graph-model.md | 基础图遍历功能 |
| 4.5 | 页面图谱关联 | 自研 | - | 页面与图谱节点关联 |
| 4.6 | 图谱搜索 | 自研 | - | 基于图谱的搜索功能 |

### 里程碑 5：摄取与编译（Week 9-10）
**目标**：文档摄取、知识提取、自动编译

| 步骤 | 任务 | 参考项目 | 参考代码 | 验收标准 |
|------|------|---------|---------|---------|
| 5.1 | 摄取管道 | SwarmVault | packages/engine/ | 文档上传、解析、存储 |
| 5.2 | 知识提取 | SwarmVault | packages/engine/ | LLM 提取概念和关系 |
| 5.3 | 日日志系统 | SwarmVault | packages/engine/ | 每日知识日志生成 |
| 5.4 | 知识编译 | SwarmVault | packages/engine/ | 日志 → 知识文章 |
| 5.5 | 索引构建 | SwarmVault | packages/engine/ | 结构化索引生成 |
| 5.6 | 摄取任务队列 | 自研 | - | 异步处理，状态跟踪 |

### 里程碑 6：Agent 记忆与 MCP（Week 11-12）
**目标**：Agent 持久记忆，MCP Server 可用

| 步骤 | 任务 | 参考项目 | 参考代码 | 验收标准 |
|------|------|---------|---------|---------|
| 6.1 | 4层记忆模型 | Mnemon | docs/design/03-concepts.md | 记忆分层存储 |
| 6.2 | 记忆衰减 | Mnemon | docs/design/ | 记忆衰减算法实现 |
| 6.3 | 记忆检索 | Mnemon | docs/design/ | 图遍历 + 语义搜索 |
| 6.4 | 记忆注入 | Mnemon | docs/harness/ | 会话开始时注入记忆 |
| 6.5 | MCP Server | Mnemon | harness/ | MCP 协议实现 |
| 6.6 | MCP 工具 | Mnemon | harness/ | AgentWiki 专用工具 |
| 6.7 | MCP 资源 | Mnemon | harness/ | 知识库作为资源暴露 |
| 6.8 | 提示词模板 | Mnemon | harness/ | 上下文注入模板 |

### 里程碑 7：整合与优化（Week 13-14）
**目标**：系统集成，性能优化，文档完善

| 步骤 | 任务 | 参考项目 | 参考代码 | 验收标准 |
|------|------|---------|---------|---------|
| 7.1 | 前端页面整合 | 自研 | - | 所有页面功能完整 |
| 7.2 | 性能优化 | Docmost | 全局 | 响应时间 < 200ms |
| 7.3 | 安全审计 | 行业实践 | - | 无高危漏洞 |
| 7.4 | 测试覆盖 | 行业实践 | - | 核心功能 80%+ 覆盖 |
| 7.5 | 部署文档 | 行业实践 | - | 生产部署指南 |
| 7.6 | 用户文档 | 行业实践 | - | 用户手册完成 |

---

## 4. 未知问题处理流程

### 4.1 标准处理流程

```
遇到未定义细节
    ↓
1. 查本手册「实现细节对照表」
    ↓ 有记录？
    是 → 按记录实现
    否 → 继续
    ↓
2. 查参考项目 codebase-memory
    - Docmost: search_graph("相关功能")
    - Outline: search_graph("相关功能")
    - SwarmVault: search_graph("相关功能")
    - Mnemon: search_graph("相关功能")
    ↓ 有参考？
    是 → 记录到本手册，按参考实现
    否 → 继续
    ↓
3. 查行业最佳实践
    - Notion/Confluence/GitHub 文档
    - 相关 RFC/规范
    ↓
4. 提出方案对比
    - 方案 A：简单实现，快速验证
    - 方案 B：完整实现，长期可用
    - 方案 C：暂不实现，标记为 TODO
    ↓
5. 决策评审
    - 是否阻塞当前里程碑？
    - 改动成本 vs 收益？
    - 是否影响架构一致性？
    - 是否可以后续无痛升级？
    ↓
6. 记录决策
    - 写入 decisions.md
    - 更新本手册「实现细节对照表」
    - 更新「工程决策地图」
```

### 4.2 决策记录模板

```markdown
## 决策记录：YYYY-MM-DD

### 问题
[描述遇到的具体问题]

### 背景
- 影响的用户场景：
- 不解决的后果：
- 解决后能带来什么价值：

### 参考来源
1. Docmost: [代码位置]
2. Outline: [代码位置]
3. SwarmVault: [代码位置]
4. Mnemon: [代码位置]
5. 行业实践: [来源]

### 方案对比

| 方案 | 实现成本 | 用户体验 | 一致性 | 选择 |
|------|---------|---------|--------|------|
| A. [简单方案] | 低 | 一般 | 最终一致 | |
| B. [完整方案] | 高 | 好 | 强一致 | ✅ |
| C. [暂不实现] | - | - | - | |

### 决策理由
[详细说明选择该方案的理由]

### 实现位置
[自研代码位置]

### 后续行动
- [ ] 实现代码
- [ ] 添加测试
- [ ] 更新文档
- [ ] 标记技术债务（如有）
```

---

## 5. 参考项目索引

### 5.1 codebase-memory 索引状态

| 项目 | 索引名称 | 节点数 | 边数 | 查询命令 |
|------|---------|--------|------|---------|
| Docmost | D-MyDocuments-AgentWiki-2-docmost | 25,715 | 44,671 | search_graph |
| Outline | D-MyDocuments-AgentWiki-2-outline | 65,844 | 107,158 | search_graph |
| SwarmVault | D-MyDocuments-AgentWiki-2-swarmvault | 4,805 | 15,303 | search_graph |
| Mnemon | D-MyDocuments-AgentWiki-2-mnemon | 6,802 | 26,956 | search_graph |

### 5.2 常用查询模板

```bash
# 查询 Docmost 认证实现
codebase-memory-mcp search_graph '{"project":"D-MyDocuments-AgentWiki-2-docmost","query":"authentication JWT OAuth"}'

# 查询 Docmost 协作编辑
codebase-memory-mcp search_graph '{"project":"D-MyDocuments-AgentWiki-2-docmost","query":"collaboration Yjs websocket"}'

# 查询 Outline API 设计
codebase-memory-mcp search_graph '{"project":"D-MyDocuments-AgentWiki-2-outline","query":"API routes documents"}'

# 查询 SwarmVault 图模型
codebase-memory-mcp search_graph '{"project":"D-MyDocuments-AgentWiki-2-swarmvault","query":"graph model knowledge"}'

# 查询 Mnemon 记忆系统
codebase-memory-mcp search_graph '{"project":"D-MyDocuments-AgentWiki-2-mnemon","query":"memory persistence graph"}'

# 获取架构概览
codebase-memory-mcp get_architecture '{"project":"D-MyDocuments-AgentWiki-2-docmost","aspects":["all"]}'
```

### 5.3 关键参考代码位置

#### Docmost
- 认证: apps/server/src/core/auth/
- 协作编辑: apps/server/src/collaboration/
- 页面管理: apps/server/src/core/page/
- 空间管理: apps/server/src/core/workspace/
- 搜索: apps/server/src/core/search/
- 数据库: apps/server/src/database/
- 编辑器: packages/editor-ext/

#### Outline
- API 路由: server/routes/
- 模型定义: server/models/
- 编辑器: app/editor/
- 组件: app/components/
- 存储: server/storage/

#### SwarmVault
- 引擎: packages/engine/
- CLI: packages/cli/
- 图模型: templates/llm-wiki-schema.md
- 摄取管道: packages/engine/src/ingest/

#### Mnemon
- 设计文档: docs/design/
- 图模型: docs/design/04-graph-model.md
- 概念: docs/design/03-concepts.md
- MCP: harness/
- 集成: docs/design/07-integration.md

---

## 附录 A：技术债务清单

| 序号 | 问题 | 影响 | 优先级 | 计划解决时间 |
|------|------|------|--------|-------------|
| 1 | Agent 编辑冲突自动合并 | 高 | P2 | 里程碑 4 |
| 2 | 向量搜索性能优化 | 中 | P3 | 里程碑 7 |
| 3 | 图谱渲染大数据量优化 | 高 | P2 | 里程碑 7 |
| 4 | 记忆衰减算法调参 | 中 | P3 | 里程碑 6 |
| 5 | MCP 工具权限细化 | 低 | P4 | 里程碑 7 |

## 附录 B：决策日志索引

所有决策记录保存在 decisions/ 目录下，按日期命名：
- decisions/2026-07-03-authentication.md
- decisions/2026-07-03-collaboration.md
- ...

---

> 本手册随项目进展持续更新。每次遇到新的工程决策，必须同步更新：
> 1. 「工程决策地图」
> 2. 「实现细节对照表」
> 3. 「决策日志」
