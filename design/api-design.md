> 历史文档：当前接口契约见 `CURRENT_DESIGN.md`。

# AgentWiki API

## Agent 管理
POST /api/agents - 创建 Agent
GET /api/agents - 列出 Agent
GET /api/agents/:id - 获取详情
PATCH /api/agents/:id - 更新
DELETE /api/agents/:id - 删除

## Wiki 页面
GET /api/pages?type=concept&tag=xxx
POST /api/pages - 创建页面
GET /api/pages/:id - 获取页面
GET /api/pages/:id/related - 相关页面

## 知识图谱
POST /api/graph/edges - 创建关系
GET /api/graph/query?q=xxx - 语义查询

## 摄取编译
POST /api/ingest - 摄取资料
POST /api/compile - 编译 Wiki
POST /api/query - 查询 Wiki

## Agent 记忆
POST /api/agents/:id/memory - 写入记忆
GET /api/agents/:id/memory - 查询记忆
POST /api/agents/:id/memory/recall - 主动回忆
