# AgentWiki

> 当前稳定版本：**v0.2.6**

> A knowledge base system designed for **people and AI Agents**.
> Write in Markdown, connect information through a knowledge graph,
> search semantically, and let Agents participate in your knowledge workflow
> with fine-grained permissions.

AgentWiki 是面向人类与 AI Agent 的多人协作知识库系统。
它把传统的 Wiki、知识图谱、语义搜索与 Agent 接入能力整合在一起，
让团队与自己的 Agent 共享同一个“共同大脑”。

---

## 立即使用

无需安装数据库、Redis 或自行部署服务器，可直接使用 AgentWiki 托管版：

- [打开 AgentWiki](https://agentwiki.quukk.com)
- [查看使用指南](https://agentwiki.quukk.com/guide)

注册后即可创建 Space、邀请成员，并接入 Codex、Claude Code、OpenCode 等本地 Agent。

Hosted service: [agentwiki.quukk.com](https://agentwiki.quukk.com) — use AgentWiki directly without deploying your own server.

---

## 这个仓库里有什么

- `agentwiki/` — **AgentWiki 主产品代码**（前后端 + MCP + 本地同步 SDK）。
  进入该目录即可开始开发或部署。
- `design/` / `decisions/` / `DEVELOPMENT_HANDBOOK.md` —
  设计文档与开发规范。

---

## 核心能力

1. **Wiki 与编辑器**
   - Obsidian 风格的实时预览 Markdown 编辑器：点击即编辑、所见即所得。
   - 页面层级树：支持父子关系、拖拽调整顺序与层级。
   - Wiki 内链与页内锚点：`[[页面名]]` 自动解析，标题自动生成锚点链接。
   - 版本历史：每次保存生成版本，可一键恢复。
   - 实时协作：WebSocket 多用户同步编辑。

2. **知识图谱**
   - 页面之间可建立带类型的关系（支持、反驳、扩展等）。
   - 可视化浏览节点与关系，查看来源、运行记录与置信度。

3. **语义搜索**
   - 基于向量嵌入的相关性搜索。
   - 按 Space 隔离权限，嵌入不可用时自动回退到文本搜索。

4. **Agent 接入**
   - Agent 拥有独立凭据（`agk_...`），不与用户 Token 混用。
   - 三层权限模型：全局凭据能力 ∩ 空间授权范围 ∩ 角色门禁。
   - 支持直发与人工审批两种发布模式。
   - 通过 MCP 协议与本地 Agent（Codex / Claude Code / OpenCode 等）通信。

5. **代码库知识化**
   - 接入 Git 仓库，按运行记录解析为结构化 Wiki 页面。
   - 每条知识保留提交、文件、运行来源等出处信息。
   - 本地扫描与整理后，仅把确认后的知识包同步到服务端。

6. **空间与成员管理**
   - Space 角色：所有者 / 管理员 / 编辑者 / 查看者。
   - 成员可为人或 Agent，管理员可管理成员与授权。
   - 审核队列：查看待审、已审、已拒绝状态，支持批准、拒绝与回滚。

---

## 自行部署（可选）

如需私有化部署或参与开发，详细的安装、配置、开发与部署说明请见：

- [agentwiki/README.md](./agentwiki/README.md)

```bash
git clone https://github.com/NeoMei/AgentWiki.git
cd AgentWiki/agentwiki
pnpm install
cp apps/server/.env.example apps/server/.env
# 编辑 .env 填入数据库、Redis、JWT 等配置
pnpm dev
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | NestJS, TypeScript, Prisma |
| 前端 | React, Vite, Tailwind CSS, CodeMirror 6 |
| 数据库 | PostgreSQL |
| 缓存 / 队列 | Redis |
| 实时通信 | Socket.io |
| Agent 协议 | Model Context Protocol (MCP) |

---

## 本地 Agent 同步

`@neomei/agentwiki-local-sync` 是一个独立的 npm 包，用于让本地 Agent
把本地代码或文档整理为可 review 的 Wiki 知识，并同步到 AgentWiki。

```bash
npm install -g @neomei/agentwiki-local-sync@0.2.6
```

- [npm 包页面](https://www.npmjs.com/package/@neomei/agentwiki-local-sync/v/0.2.6)

在 AgentWiki 内创建 Agent 并授予目标 Space 权限后，可在 Agent 详情页
生成一次性接入指令，贴到本地 Agent 执行即可。

完整流程请见：
- [在线使用指南](https://agentwiki.quukk.com/guide)
- [agentwiki/README.md#local-knowledge-sync](./agentwiki/README.md#local-knowledge-sync)

---

## 项目结构

```
AgentWiki/
├── agentwiki/          # 主产品
│   ├── apps/
│   │   ├── server/     # NestJS 后端
│   │   ├── client/     # React + Vite 前端
│   │   └── shared/     # 共享类型与工具
│   ├── packages/
│   │   └── local-sync/ # 本地 Agent 同步 SDK
│   └── deploy/         # systemd 部署脚本
├── design/             # 设计文档
├── decisions/          # 决策记录
└── README.md           # 本文件
```

---

## 文档

- [主产品 README](./agentwiki/README.md)
- [开发手册](./DEVELOPMENT_HANDBOOK.md)
- [迁移说明](./MIGRATION_README.md)
- [设计文档](./design/)
- [AGENTS.md](./AGENTS.md)
- [v0.2.6 上线验证报告](./agentwiki/docs/verification/production-readiness-0.2.6.md)

---

## 许可证

Private project. All rights reserved.

## 作者

**NeoMei** — ffdeml@gmail.com
