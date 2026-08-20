# 哈希文件名可读性协调方案

## 文档状态

- 提案版本：`1`
- 创建日期：2026-08-16
- 状态：待讨论
- 优先级：P0
- 涉及项目：AgentWiki-Obsidian 插件、AgentWiki 主项目

## 1. 问题分析

### 1.1 当前插件实现

插件在 `.agentwiki/` 目录下使用 `opaqueFileKey(pageId)` 生成文件名：

```typescript
// src/core/identity-key.ts
export async function opaqueFileKey(id: string): Promise<string> {
  if (!id) throw new TypeError("Empty file identity");
  return `p-${await sha256Hex(new TextEncoder().encode(id))}`;
}
```

**调用点分布**：
- `src/storage/generation.ts`：存储 base body（`base/p-{hash}.md`）
- `src/application/push-service.ts`：存储 push payload（`payload/p-{hash}.md`）
- `src/application/sync-runtime.ts`：存储 downloads 和 push-preview（`downloads/{previewId}/p-{hash}.md`）

**问题**：
- 文件名完全不可读，调试时需要查数据库才能知道对应哪个页面
- 用户无法通过文件名理解内容
- 与主项目的 `syncPath` 概念脱节

### 1.2 主项目契约定义

主项目契约 `docs/contracts/agentwiki-obsidian-sync-api-v1.md` 已定义：

- **`syncPath`**：Space 内的规范化 Markdown 相对路径（如 `Guide.md`、`Projects/README.md`）
- **`pathKey`**：`syncPath` 的 case-folded 版本，用于唯一性校验
- **迁移规则**（第 209-210 行）：
  - 若 `sourcePath` 合法，使用该路径
  - 否则使用 `pages/p-<idFileKey(knowledgeKey)>.md`

**关键约束**：
- `syncPath` 必须通过 `normalizeSyncPath(path)` 校验
- 路径段使用 Unicode NFC，禁止特殊字符
- 每个路径段 UTF-8 编码最长 255 字节，完整路径最长 1,024 字节
- 扩展名必须是 `.md`

## 2. 候选方案

### 方案 A：优先使用 syncPath，回退到 opaqueFileKey

**插件侧**：
```typescript
async function localFileName(page: SyncPageRecord): Promise<string> {
  if (page.path && isValidSyncPath(page.path)) {
    return page.path;
  }
  return `p-${await idFileKey(page.pageId)}.md`;
}
```

**优点**：
- 文件名可读，与主项目一致
- 向后兼容：没有 `syncPath` 的旧数据仍可用
- 用户可以直接在 `.agentwiki/` 目录下看到可读文件名

**缺点**：
- 需要修改 storage 层，让它能接收 `syncPath`
- 需要处理路径冲突（虽然服务端已保证唯一性）
- 迁移逻辑复杂：需要把现有哈希文件重命名为 `syncPath`

### 方案 B：使用 pathKey 作为文件名

**插件侧**：
```typescript
async function localFileName(page: SyncPageRecord): Promise<string> {
  return page.pathKey;
}
```

**优点**：
- `pathKey` 已经是规范化的，无需额外校验
- 与服务端唯一性约束一致

**缺点**：
- `pathKey` 是 case-folded 的，可能丢失原始大小写信息
- 例如 `Guide.md` 变成 `guide.md`，可读性略差

### 方案 C：混合方案 - 目录结构 + syncPath

**插件侧**：
```
.agentwiki/
  base/
    {generationId}/
      Guide.md              # 使用 syncPath
      Projects/README.md    # 保持目录结构
```

**优点**：保持目录结构，与 Obsidian vault 一致

**缺点**：需要处理目录创建和清理，迁移成本最高

### 方案 D：保持现状，增加映射文件

**插件侧**：
```
.agentwiki/
  base/
    p-{hash}.md
  index.json  # { "p-{hash}": "Guide.md", ... }
```

**优点**：无需修改 storage 层

**缺点**：文件名仍然不可读，调试体验未改善

## 3. 推荐方案

**推荐方案 A：优先使用 syncPath，回退到 opaqueFileKey**

### 3.1 理由

1. **与主项目一致**：主项目已经定义了 `syncPath`，插件应该优先使用
2. **可读性最佳**：用户可以直接看到文件名
3. **向后兼容**：没有 `syncPath` 的旧数据仍可用哈希文件名
4. **迁移成本可控**：可以分阶段迁移，不阻塞新功能

### 3.2 插件侧实现要点

#### 修改 storage 层

```typescript
// src/storage/generation.ts
async writeBaseBody(
  generationId: string,
  page: SyncPageRecord,  // 改为接收完整 page 对象
  body: string
): Promise<void> {
  const fileName = page.path || `p-${await idFileKey(page.pageId)}.md`;
  const filePath = this.path(generationId, `base/${fileName}`);
  await writeFile(filePath, body, "utf-8");
}
```

#### 修改 push-service

```typescript
// src/application/push-service.ts
async writePayload(
  transactionId: string,
  change: PushChange,  // 包含 path
  body: string
): Promise<void> {
  const fileName = change.path || `p-${await idFileKey(change.pageId)}.md`;
  const filePath = `${this.root}/payload/${fileName}`;
  await writeFile(filePath, body, "utf-8");
}
```

#### 添加路径校验

```typescript
// src/core/sync-path.ts
import { normalizeSyncPath } from "../agentwiki/protocol";

export function isValidSyncPath(path: string): boolean {
  try {
    normalizeSyncPath(path);
    return true;
  } catch {
    return false;
  }
}
```

#### 迁移逻辑

```typescript
// src/storage/migration.ts
async function migrateHashedFiles(
  storageRoot: string,
  fetchPagePath: (pageId: string) => Promise<string | null>
): Promise<void> {
  const baseDir = `${storageRoot}/base`;
  const files = await readdir(baseDir);
  
  for (const file of files) {
    if (!file.startsWith("p-") || !file.endsWith(".md")) continue;
    
    const hash = file.slice(2, -3);
    const pagePath = await fetchPagePath(hash);
    if (pagePath) {
      const newPath = `${baseDir}/${pagePath}`;
      await rename(`${baseDir}/${file}`, newPath);
    }
  }
}
```

### 3.3 主项目侧实现要点

#### 确保 Snapshot 返回 syncPath

- Snapshot API 返回的每个 page 都包含 `path`（即 `syncPath`）
- Delta API 返回的每个 `DeltaItem` 都包含 `path`
- Push confirmation 返回的 manifest 包含 `path`

#### 提供批量查询接口（可选）

```typescript
// POST /api/sync/v1/spaces/{spaceId}/pages/paths
interface BatchPathRequest {
  pageIds: string[];
}

interface BatchPathResponse {
  paths: Record<string, string | null>; // pageId -> syncPath
}
```

### 3.4 迁移计划

| 阶段 | 任务 | 依赖 | 预计时间 |
|---|---|---|---|
| 1 | 插件侧准备 | 无 | 1-2 天 |
| 2 | 主项目侧准备 | 无 | 2-3 天 |
| 3 | 联调测试 | 阶段 1、2 | 1 天 |
| 4 | 插件迁移 | 阶段 3 | 1 天 |
| 5 | 生产部署 | 阶段 4 | 1 天 |

## 4. 风险与缓解

### 4.1 路径冲突

**风险**：客户端和服务端的 `syncPath` 不一致

**缓解**：
- 插件始终信任服务端的 `syncPath`
- 拉取时以服务端为准，覆盖本地文件
- 推送时以本地为准，服务端校验 `pathKey` 唯一性

### 4.2 迁移失败

**风险**：迁移过程中断

**缓解**：
- 迁移任务可重试
- 使用事务性重命名
- 保留哈希映射表，支持回退

### 4.3 向后兼容

**风险**：旧版本插件无法读取新文件名

**缓解**：
- 插件同时支持两种文件名，根据文件是否存在自动选择

## 5. 决策点

1. **是否需要批量查询接口？** 建议：需要，减少迁移时的 API 调用
2. **迁移是否必须？** 建议：必须，所有用户都迁移到新文件名
3. **是否保留 opaqueFileKey？** 建议：保留，迁移完成后保留 6 个月再删除

## 附录

### A. 相关文件

- 插件：`src/core/identity-key.ts`、`src/storage/generation.ts`、`src/application/push-service.ts`
- 主项目：`docs/contracts/agentwiki-obsidian-sync-api-v1.md`（第 209-219 行）
