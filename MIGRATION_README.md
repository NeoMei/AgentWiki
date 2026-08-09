# AgentWiki 项目迁移指南

> 本文件供目标机器上的 Codex 读取，帮助快速接手项目。
> 生成日期：2026-07-16

---

## 1. 包内容

压缩包：`AgentWiki-full.tar.gz`（约 977 MB）

包含完整的源代码、Git 历史、Codex 项目记忆和所有配置文件。
**已排除** `node_modules`（需在新机器上重新安装）和旧的部署包 `.tar.gz`。

### 顶层结构

| 目录/文件                     | 说明                                                             |
| ------------------------- | -------------------------------------------------------------- |
| `agentwiki/`              | **主项目**，pnpm monorepo（React/Vite + NestJS + Prisma/PostgreSQL） |
| `design/`                 | 设计文档、架构图、SQL schema                                            |
| `decisions/`              | 决策记录                                                           |
| `.codex-memory/`          | **Codex 项目级结构化记忆**（必须保留）                                       |
| `.git/`                   | 完整 Git 历史                                                      |
| `AGENTS.md`               | Codex 工作规则                                                     |
| `DEVELOPMENT_HANDBOOK.md` | 开发手册                                                           |

---

## 2. 恢复步骤

### 2.1 解压

```powershell
# 假设项目放到 D:\MyDocuments\AgentWiki
mkdir "D:\MyDocuments\AgAgentWiki-Force
cd "D:\MyDocuments"
tar -xzf "E:\AgentWiki-Migration\AgentWiki-full.tar.gz"
# 解压后会在当前目录生成 "AgenAgentWiki夹
```

> 如果路径不同，解压后把 `AgentWiki` 文件夹移到目标位置即可。

### 2.2 安装运行时依赖

主项目 `agentwiki` 需要：

| 依赖         | 版本要求                                                              |
| ---------- | ----------------------------------------------------------------- |
| Node.js    | 24.x 或 26.x（仓库约束为 `>=24 <25 || >=26 <27`）                  |
| pnpm       | 11.9.0（`npm install -g pnpm@11.9.0`）                            |
| PostgreSQL | ≥ 16（生产用 18.4）                                                    |
| Redis      | 任意稳定版                                                             |

```powershell
# 进入主项目
cd "D:\MyDocuments\AgentWiki\agentwiki"

# 确认运行时并按锁文件安装依赖
node --version  # 必须为 v24.x 或 v26.x
pnpm --version  # 必须为 11.9.0
pnpm install --frozen-lockfile

# 复制环境配置（.env 已包含在包中，如需重置从 .env.example 复制）
# cp .env.example .env  # 按需修改数据库连接等

# 生成 Prisma Client
pnpm prisma generate

# 运行数据库迁移（确保 PostgreSQL 已启动）
pnpm prisma migrate deploy

# 启动开发服务
pnpm dev
```

## 3. Codex 接手须知

### 3.1 项目记忆（重要）

项目使用 `.codex-memory/` 作为结构化记忆。新会话启动时按以下顺序读取：

1. `.codex-memory/current.md` — 当前有效状态、目标、约束
2. `.codex-memory/spec/index.md` — 长期稳定规则索引
3. `.codex-memory/tasks/index.md` — 任务列表（当前无活跃任务）

**不要**主动加载 `.codex-memory/archive/`，仅在追溯历史时查阅。

### 3.2 当前项目状态摘要

- **主产品**：AgentWiki — 一个 Agent 知识库平台（React/Vite 前端 + NestJS 后端 + Prisma/PostgreSQL）
- **技术栈**：React 18, Vite 5, NestJS, Prisma 5.22, PostgreSQL, Redis
- **状态**：P0-P6 全部闭环，所有门禁通过（ESLint、类型检查、58 项 Jest 测试、4 项 Vitest 测试、生产构建）
- **远端部署**：直部署模式（非 Docker），三个 systemd 服务：`agentwiki-api`、`agentwiki-worker`、`agentwiki-frontend`
- **关键约束**：
  - Markdown 编辑器使用单工作区（Edit/Preview 切换），不恢复双栏
  - 新增用户可见文案必须同时提供中英文
  - Agent 是人类拥有的独立实体，权限为 Credential Scope ∩ Space Grant ∩ Agent 状态 ∩ Space 策略

### 3.3 关键文件索引

| 用途         | 路径                           |
| ---------- | ---------------------------- |
| 当前设计       | `design/CURRENT_DESIGN.md`   |
| 整改记录       | `design/REMEDIATION_TODO.md` |
| 运维备份       | `design/OPERATIONS.md`       |
| 部署脚本       | `agentwiki/deploy.sh`        |
| systemd 单元 | `agentwiki/deploy/systemd/`  |
| 开发手册       | `DEVELOPMENT_HANDBOOK.md`    |

### 3.4 环境变量

包中包含以下 `.env` 文件（含实际配置）：

- `agentwiki/.env`
- `agentwiki/apps/server/.env`
- `outline/.env.development`
- `outline/.env.test`

> ⚠️ 这些文件包含数据库连接、JWT 密钥等敏感信息。如果新机器使用不同的数据库地址或端口，需要相应修改 `DATABASE_URL`、`REDIS_URL` 等。

---

## 4. Git 仓库说明

项目根目录的 `.git` 是一个**未初始化提交**的 Git 仓库——所有文件都是 untracked（`??`），没有任何 commit，也没有配置远程仓库。

如果需要在新机器上开始正式的版本管理：

```powershell
cd "D:\MyDocuments\AgentWiki"
git add -A
git commit -m "Initial commit: AgAgentWikiull project snapshot"
```

---

## 5. 快速验证清单

解压并安装依赖后，执行以下步骤确认环境正常：

- [ ] `cd agentwiki && pnpm install` 成功
- [ ] `pnpm prisma generate` 成功
- [ ] PostgreSQL 和 Redis 已启动
- [ ] `pnpm prisma migrate deploy` 成功
- [ ] `pnpm dev` 启动后前端可访问
- [ ] `/api/health` 返回正常
- [ ] Codex 能读取 `.codex-memory/current.md`

---

## 6. 打包排除清单

以下内容**未包含**在压缩包中，需要在新机器上按需恢复：

- `node_modules/`（所有子项目） → 重新 `pnpm/yarn install`
- `agentwiki.tar.gz`（390MB 旧打包）→ 不需要
- `agentwiki-deploy*.tar.gz`（5 个部署包）→ 不需要
- `z_ai-coding-helper-0.0.7.tgz` → 按需重新下载
- PostgreSQL 数据 → 需要从远端备份恢复或重新迁移

---

*本文件由打包脚本自动生成。如有疑问，先读 `.codex-memory/current.md`。*
