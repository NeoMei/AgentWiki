> 历史文档：当前实施规范见 `CURRENT_DESIGN.md`，执行进度见 `REMEDIATION_TODO.md`。

AgentWiki 完整规划文档

核心问题：参考现有项目 vs 不参考

结论：分层参考，选择性吸收

参考的目的：验证自己的设计是否遗漏，而不是复制代码。

第一层：界面层 (UI Layer)

1.1 页面清单

页面 | 路由 | 角色 | 核心功能
登录页 | /login | 所有人 | OAuth2 + 邮箱登录
注册页 | /register | 所有人 | 账号创建
知识库首页 | /wiki | 登录用户 | 空间列表、最近活动
空间页面 | /wiki/:spaceId | 空间成员 | 页面树、搜索
页面编辑 | /wiki/:spaceId/:pageId/edit | 编辑者 | Markdown + Frontmatter 编辑
页面查看 | /wiki/:spaceId/:pageId | 读者 | 渲染、图谱、评论
图谱视图 | /wiki/:spaceId/graph | 读者 | 交互式知识图谱
Agent 管理 | /agents | 所有者 | Agent CRUD、权限、日志
摄取任务 | /ingest | 编辑者 | 上传资料、查看编译状态
审批队列 | /approvals | 所有者 | 审批 Agent 提交
设置 | /settings | 所有者 | 空间设置、成员管理

1.2 界面原型

见 page-prototype.html 和 agent-management.html（已创建）

第二层：模块层 (Module Layer)

2.1 后端模块划分

agentwiki-server/src/modules/
  auth/                    认证模块
  users/                   用户模块
  agents/                  Agent 模块 (核心新增)
  spaces/                  空间模块
  pages/                   页面模块 (扩展)
  knowledge-graph/         知识图谱模块 (核心新增)
  wiki-engine/             Karpathy 引擎 (核心新增)
  agent-memory/            Agent 记忆模块 (核心新增)
  mcp/                     MCP Server (核心新增)
  search/                  搜索模块

2.2 前端模块划分

agentwiki-client/
  app/                             Next.js 15 App Router
  components/
    ui/                            shadcn/ui 组件
    layout/                        布局组件
    editor/                        Markdown 编辑器
    graph/                         知识图谱可视化
    agent/                         Agent 相关组件
    wiki/                          Wiki 相关组件
  lib/                             工具库
  hooks/                           自定义 Hooks
  types/                           TypeScript 类型

第三层：接口层 (API Layer)

3.1 REST API 详细定义

Agent 管理
POST /api/agents
  Body: { name, type, permissions, scope, approvalMode, memoryEnabled }
  Response: { id, name, apiKey, apiSecret, status, createdAt }

GET /api/agents
  Response: { agents: [{ id, name, type, status, stats }] }

GET /api/agents/:id
GET /api/agents/:id/logs
PATCH /api/agents/:id
DELETE /api/agents/:id

Wiki 页面
POST /api/pages
  Body: { title, content, pageType, frontmatter, spaceId }

GET /api/pages/:id
  Response: { id, title, content, pageType, frontmatter, confidence, author, relatedPages, graphEdges, activity }

GET /api/pages/:id/related
GET /api/pages?type=concept&tag=xxx&author=agent:xxx

知识图谱
POST /api/graph/edges
  Body: { sourceId, targetId, edgeType, weight, confidence, evidence }

GET /api/graph/query?q=xxx
  Response: { nodes, edges, answer, confidence }

摄取与编译
POST /api/ingest
  Body: { sourceType, content, fileName, spaceId, autoCompile }
  Response: { taskId, status }

GET /api/ingest/:taskId
POST /api/compile
POST /api/query
POST /api/lint

Agent 记忆
POST /api/agents/:id/memory
  Body: { memoryType, content, sourcePageIds, importance, entities, tags }

GET /api/agents/:id/memory?type=semantic&query=xxx
POST /api/agents/:id/memory/recall
POST /api/agents/:id/memory/consolidate

3.2 错误码定义

E1000 - UNKNOWN_ERROR
E1001 - INVALID_REQUEST
E1002 - UNAUTHORIZED
E1003 - FORBIDDEN
E1004 - NOT_FOUND
E1005 - RATE_LIMITED

E1100 - INVALID_CREDENTIALS
E1101 - TOKEN_EXPIRED
E1102 - INVALID_API_KEY
E1103 - AGENT_REVOKED
E1104 - AGENT_SCOPE_EXCEEDED

E1200 - PAGE_NOT_FOUND
E1201 - PAGE_CONFLICT
E1202 - PAGE_LOCKED
E1203 - INVALID_PAGE_TYPE
E1204 - INVALID_FRONTMATTER

E1300 - CIRCULAR_REFERENCE
E1301 - EDGE_EXISTS
E1302 - INVALID_EDGE_TYPE

E1400 - INGEST_FAILED
E1401 - UNSUPPORTED_FILE_TYPE
E1402 - FILE_TOO_LARGE
E1403 - COMPILE_FAILED

E1500 - MEMORY_NOT_FOUND
E1501 - MEMORY_QUOTA_EXCEEDED

E1600 - APPROVAL_REQUIRED
E1601 - APPROVAL_DENIED

第四层：数据层 (Data Layer)

4.1 实体关系

users (1) to (N) spaces (owner)
users (1) to (N) agents (owner)
spaces (1) to (N) pages
spaces (1) to (N) knowledge_edges
pages (1) to (N) pages (parent/children)
pages (1) to (N) knowledge_edges (source/target)
agents (1) to (N) agent_memories
agents (1) to (N) agent_logs

4.2 完整数据库 Schema

见 schema.sql 文件（已创建）

第五层：技术栈实现方法

5.1 后端

组件 | 技术 | 用途
运行时 | Node.js >= 20 | 执行环境
框架 | NestJS 10.x | Web 框架
语言 | TypeScript 5.x | 类型安全
ORM | Prisma 5.x | 数据库操作
数据库 | PostgreSQL 15+ | 主数据库
向量扩展 | pgvector 0.5+ | 向量搜索
缓存 | Redis 7+ | 会话、锁、队列
任务队列 | BullMQ 4.x | 异步任务
实时协作 | Yjs + y-websocket | 协作编辑
LLM | OpenAI SDK / Ollama | 编译引擎
认证 | Passport + JWT | 人类认证
Agent 认证 | 自定义 API Key | Agent 认证
测试 | Jest 29.x | 单元测试

5.2 前端

组件 | 技术 | 用途
框架 | Next.js 15.x | React 框架
语言 | TypeScript 5.x | 类型安全
样式 | Tailwind CSS 3.x | 原子化 CSS
组件 | shadcn/ui | UI 组件库
编辑器 | TipTap 2.x | Markdown 编辑器
协作 | Yjs 13.x | 协作编辑
图谱 | Cytoscape.js 3.x | 知识图谱可视化
状态 | Zustand 4.x | 全局状态
请求 | TanStack Query 5.x | 服务端状态
表单 | React Hook Form 7.x | 表单管理
验证 | Zod 3.x | 运行时验证

5.3 部署

Docker Compose:
  nginx (反向代理) :80
  Next.js (前端) :3000
  NestJS (后端) :3001
  PostgreSQL + pgvector :5432
  Redis (缓存/队列) :6379
  MinIO (文件存储) :9000

第六层：Demo 代码

6.1 NestJS Controller 示例

// agents.controller.ts
@Controller('api/agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post()
  async create(@CurrentUser() user: User, @Body() dto: CreateAgentDto) {
    return this.agentsService.create(user.id, dto);
  }

  @Get()
  async findAll(@CurrentUser() user: User, @Query() query: ListAgentsQuery) {
    return this.agentsService.findAll(user.id, query);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.agentsService.findOne(user.id, id);
  }

  @Patch(':id')
  async update(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agentsService.update(user.id, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: User, @Param('id') id: string) {
    await this.agentsService.remove(user.id, id);
    return { success: true };
  }
}

6.2 Agent 认证 Guard 示例

// api-key.guard.ts
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private prisma: PrismaService, private crypto: CryptoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];
    const apiSecret = request.headers['x-api-secret'];

    if (!apiKey || !apiSecret) {
      throw new UnauthorizedException('API key and secret required');
    }

    const agent = await this.prisma.agent.findFirst({
      where: { status: 'active' }
    });

    if (!agent) throw new UnauthorizedException('Invalid API key');

    const keyValid = await this.crypto.compare(apiKey, agent.apiKeyHash);
    if (!keyValid) throw new UnauthorizedException('Invalid API key');

    const secretValid = await this.crypto.compare(apiSecret, agent.apiSecretHash);
    if (!secretValid) throw new UnauthorizedException('Invalid API secret');

    request.agent = agent;
    return true;
  }
}

6.3 前端组件示例

// agent-card.tsx
export function AgentCard({ agent, onPause, onResume }: AgentCardProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleToggle = async () => {
    setIsLoading(true);
    try {
      if (agent.status === 'active') await onPause(agent.id);
      else await onResume(agent.id);
    } finally { setIsLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary">🤖</div>
            <div>
              <h3>{agent.name}</h3>
              <p>{agent.type}</p>
            </div>
          </div>
          <Badge>{agent.status}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-4">
          <div><div className="text-2xl font-bold">{agent.stats.pagesEdited}</div><div>编辑</div></div>
          <div><div className="text-2xl font-bold">{agent.stats.pagesCreated}</div><div>创建</div></div>
          <div><div className="text-2xl font-bold">{agent.stats.memoryCount}</div><div>记忆</div></div>
          <div><div className="text-2xl font-bold">{agent.stats.pendingApprovals}</div><div>待审批</div></div>
        </div>
        <div className="flex gap-2 mt-4">
          <Button variant="outline">查看日志</Button>
          <Button variant="outline">查看记忆</Button>
          <Button variant="outline">编辑权限</Button>
          <Button onClick={handleToggle}>{agent.status === 'active' ? '暂停' : '恢复'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

参考策略总结

参考什么

来源 | 参考内容 | 目的
Docmost | 数据库 Schema 设计、权限模型、协作编辑集成 | 验证自己的设计是否遗漏
Outline | API 设计模式、前端组件结构 | 参考成熟产品的交互模式
SwarmVault | 摄取/编译/查询引擎的工作流、四层记忆模型 | 理解 Karpathy 思想的实现
Mnemon | 记忆衰减算法、图遍历检索 | 参考算法实现

不参考什么

内容 | 原因
具体代码实现 | 需要根据自己的架构重新设计
前端组件库选择 | 根据现代技术栈选择
部署架构 | 根据实际规模调整
具体配置 | 环境不同，配置需自定义

参考方法

1. 阅读 README 和文档 -> 理解产品功能和设计决策
2. 查看数据库 Schema -> 对比自己的设计，查漏补缺
3. 查看 API 文档 -> 参考接口命名和错误处理模式
4. 查看关键代码 -> 理解复杂逻辑（权限检查、协作同步）
5. 不复制代码 -> 用自己的技术栈重新实现
