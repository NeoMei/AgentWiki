# Obsidian Sync v1 主项目实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AgentWiki 主项目交付浏览器协议包、人类设备身份与 `/api/sync/v1` 同步边界，使 Obsidian 插件可对真实 AgentWiki 完成连接、Snapshot/Delta 分页读取与原子 Push。

**Architecture:** 三个交付物按依赖顺序推进。协议包 `@neomei/agentwiki-sync-protocol` 是纯浏览器 ESM，内嵌 Unicode 15.1 case folding，供插件与服务端共用。人类设备身份是独立凭据模型，区分于 AgentCredential。sync v1 建立在规范化 Page rows 与统一 revision 写入器上，通过 Release A/B 两阶段迁移保证现有 local-sync 兼容。

**Tech Stack:** TypeScript、Zod、Prisma/PostgreSQL、NestJS、pnpm workspace、Vitest、Web Crypto。

## Global Constraints

- 产品代码只改 `/Users/neomei/项目/codexprojects/AgentWiki /agentwiki/`；不得修改 `docmost/mnemon/openwiki/outline/swarmvault` gitlink。
- 权威契约：`agentwiki/docs/contracts/agentwiki-obsidian-sync-api-v1.md`，53 项验收全部满足。
- 协议包 `@neomei/agentwiki-sync-protocol` 禁止 `node:crypto`、`Buffer`、Node 内置模块、网络请求与凭据持久化；hash 用 Web Crypto，接受/返回 `Uint8Array` 和字符串。
- 协议包内嵌 Unicode 15.1 CaseFolding.txt 的 C+F 状态（full case folding），不依赖运行时 locale。
- 契约 3.5 固定 hash fixture 必须在浏览器与 Node 都通过。
- 迁移按 expand/backfill/contract：Release A 双写并 backfill，Release B contract 并把 legacy JSON 置 null；顺序不可颠倒。

---

## Milestone 1：浏览器兼容协议包

### Task 1.1: 建立协议包工程骨架

**Files:**
- Create: `agentwiki/packages/sync-protocol/package.json`
- Create: `agentwiki/packages/sync-protocol/tsconfig.json`
- Create: `agentwiki/packages/sync-protocol/vitest.config.ts`
- Create: `agentwiki/packages/sync-protocol/README.md`

**Interfaces:**
- Produces: `@neomei/agentwiki-sync-protocol` 包，根入口导出后续模块全部符号。

- [ ] **Step 1: package.json 固定包名、ESM、依赖 zod**
- [ ] **Step 2: tsconfig 与 vitest 配置对齐 local-sync**
- [ ] **Step 3: 在 workspace 根 build/test/typecheck 中加入该包**
- [ ] **Step 4: 验证空包可被 workspace 解析**

### Task 1.2: 内嵌 Unicode 15.1 case folding 数据

**Files:**
- Create: `agentwiki/packages/sync-protocol/src/unicode/case-folding.ts`
- Create: `agentwiki/packages/sync-protocol/src/unicode/case-folding.spec.ts`

**Interfaces:**
- Produces: `foldCase(text): string`（默认 full folding，即 C+F 状态）。

- [ ] **Step 1: 从官方 15.1 CaseFolding.txt 生成 C+F 映射并写成源码数据**
- [ ] **Step 2: fixture 验证 `ß→ss`、`İ→i̇`、`ı→i`**

### Task 1.3: canonical serialization

**Files:**
- Create: `agentwiki/packages/sync-protocol/src/canonical.ts`
- Create: `agentwiki/packages/sync-protocol/src/canonical.spec.ts`

**Interfaces:**
- Produces: `canonicalBytes(value): Uint8Array`、`comparePushChanges`。

- [ ] **Step 1: 对象 key 按 code point 升序、字符串最小转义、拒绝未配对 surrogate/undefined/NaN/Infinity/循环**
- [ ] **Step 2: fixture 验证 3.5 canonical manifest JSON**

### Task 1.4: hash 函数

**Files:**
- Create: `agentwiki/packages/sync-protocol/src/hash.ts`
- Create: `agentwiki/packages/sync-protocol/src/hash.spec.ts`

**Interfaces:**
- Produces: `sha256Hex`、`contentHash`、`confirmationHash`、`batchHash`、`revisionContentHash`、`capabilitiesHash`、`exchangeRequestHash`、`idFileKey`。

- [ ] **Step 1: Web Crypto SHA-256 实现**
- [ ] **Step 2: 3.5 fixture：contentHash `Hello\n`、confirmationHash、batchHash、428 byte 计数、pathKey**

### Task 1.5: 路径、标题、ID 与解析器

**Files:**
- Create: `agentwiki/packages/sync-protocol/src/normalize.ts`
- Create: `agentwiki/packages/sync-protocol/src/parse.ts`
- Create: `agentwiki/packages/sync-protocol/src/normalize.spec.ts`

**Interfaces:**
- Produces: `normalizeMarkdown`、`normalizeSyncPath`、`pathKey`、`parseDecimalCount`、`parseBatchIndex`、`parsePageLimit`。

### Task 1.6: 类型与运行时 Schema

**Files:**
- Create: `agentwiki/packages/sync-protocol/src/types.ts`
- Create: `agentwiki/packages/sync-protocol/src/schemas.ts`

**Interfaces:**
- Produces: 契约第 14.1 节全部类型与同名 Schema，路径参数、query、body、响应、错误 envelope。

### Task 1.7: 批次划分与根导出

**Files:**
- Create: `agentwiki/packages/sync-protocol/src/batching.ts`
- Modify: `agentwiki/packages/sync-protocol/src/index.ts`

**Interfaces:**
- Produces: `partitionPushChanges`、根入口聚合导出。

---

## Milestone 2：人类设备身份

（在协议包完成后展开：连接码、exchange、session、activate、revoke、设备管理、server instance identity、deployment seed。）

## Milestone 3：sync v1 API 与数据库迁移

（在身份完成后展开：规范化 rows、sidecar、bigint 指标、revision retention、keyset cursor、Push session、统一 revision 写入器、Release A/B。）
