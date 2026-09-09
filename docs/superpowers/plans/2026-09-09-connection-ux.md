# 接入体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Read only your task brief plus spec. Steps use checkbox syntax.

**Goal:** 从 Obsidian 和真实 Agent 客户端完成可发现、可恢复、可验证的接入。

**Architecture:** 现有设备授权和安装服务上增加 purpose 隔离的 Obsidian 授权分支；Local Sync 增加分步 JSON 接入，复用安装器与认证；网页和插件对齐完整流程。

**Tech Stack:** React/Vite, NestJS/Prisma/PostgreSQL/Redis, TypeScript CLI, Obsidian API.

**Spec:** `docs/superpowers/specs/2026-09-09-connection-ux-design.md`

## Global Constraints

- 主仓末尾空格；Git 在仓库根显式 `--work-tree="$PWD"`；每个实现者独立工作树，不操作他人工作树、数据或共享 dist。
- 不更改 Folder/Page/CAS/treeRevision/同步协议/数据库 schema。主应用、Local Sync、插件独立发行。
- 所有网页文案中英文；沿用现有组件。审批与同步明确确认不减少。
- 只用本轮独立测试 home/Vault/DB/Redis namespace，禁止真实用户数据或生产写入。每个任务记录 red/green 和实际命令结果。
- 不启动下级代理。完成实现、测试、自审、提交并报告；控制器派独立审查。所有报告进入控制器指定 SDD 目录。

### Task 1: 服务端设备授权与可访问空间接口

**Files:** `agentwiki/apps/server/src/onboard/{onboard-device.service,onboard.types,onboard.dto,onboard.controller,onboarding-token.guard,onboard.module}.ts`（按实际文件名定位）；`apps/server/src/integrations/obsidian/` 下 controller/service/module；对应 spec。

**Interfaces:** Produces spec 所定义的 Obsidian start/poll 和 GET `/onboard/spaces`；公开授权 session 新增 obsidian clientType/purpose，已有 DTO/消费者继续兼容。Consumes existing installation/exchange and authorization services.

- [x] 编写失败测试，分别覆盖以下行为：
```ts
expect((await start({pluginVersion:'0.4.0'})).verificationUriComplete).toContain('/onboard/device?user_code=');
expect(await poll(deviceCode)).toMatchObject({status:'authorization_pending'});
// 批准后同一个有效 deviceCode 重放取回同一 code；未批准、过期、不同 purpose 均不得取到 code。
expect((await poll(deviceCode)).code).toBe((await poll(deviceCode)).code);
// Space 列表只含能用于 bootstrap 的空间，不扩大权限。
```
- [x] 运行对应 Nest/Jest spec 并记录预期失败。
- [x] 实现 purpose 边界、受控生命周期、幂等安装码兑换入口、只读 spaces API。先向控制器报告公开类型确定结果，接口与 spec 差异须协调。
- [x] 运行相关 onboard/integrations 全部 spec、server typecheck，检查 module graph 依赖。记录真实 Redis/DB 测试所需 fixture，控制器统一调度。
- [x] 自审并提交 `feat(onboarding): add browser authorization for Obsidian`，报告文件/commit/测试和未完成证据。

### Task 2: Local Sync 可恢复分步接入

**Files:** `agentwiki/packages/local-sync/src/cli.ts`、`onboarding/` 下新 steps runtime/storage/types 及必要旧接口扩展；相关 spec；CLI 文档/测试。只改 Local Sync 与其有针对性的 scripts，不改网页/server/version/lockfile。

**Interfaces:** Consumes Task1 GET `/onboard/spaces` and existing device/bootstrap APIs. Produces spec 的四条 `onboard start/status/continue` JSON 命令及可供页面提示词使用的准确示例，写入报告。

- [x] 先加真实文件 session 测试：
```ts
// start 返回 authorization_required 并结束；新进程可 status，同一 session continue。
expect(status.sessionId).toBe(start.sessionId);
expect(JSON.stringify(status)).not.toMatch(/awo_|awd_/);
// 未输入 sourcePaths 仍可完成配置；扫描/同步依赖若被调用则测试直接失败。
// 重复确认、错 hash、并发 continue、重启恢复均不重复 bootstrap 或覆写配置。
```
- [x] 运行聚焦测试，保留 RED 证据。
- [x] 编写小型独立分步 runtime/持久化模块，复用现有 bootstrap installer、配置保护和 OnboardingClient；不重写旧 NDJSON coordinator。所有暂停点有恢复机制；有界返回、秘密本地保存，status 只读。
- [x] 以安装和握手结果报告连接；不要求扫描，不暴露未支持 deep。保留旧 NDJSON/human/--code 流程并回归。
- [x] 运行 Local Sync onboarding/CLI/installer spec、typecheck/build，然后全 Local Sync 测试一次；按实际 shell 平台验证命令文件输入和多进程恢复。
- [x] 自审提交 `feat(local-sync): add resumable step-based onboarding`，报告明确 CLI/JSON 形状和宿主重载/验证下一步。

### Task 3: Obsidian 浏览器接入与恢复 UI

**Files:** 插件独立仓 `src/application/` 新 browser-authorization 模块、`src/obsidian/settings-tab.ts`、`src/main.ts`、适配器/用户错误模块及相关 tests/docs。不修改主仓；只通过公开 HTTP 契约集成。

**Interfaces:** Consumes Task1 start/poll + existing exchange/activate. Existing plugin `connect(code)` 为自动授权完成后的安全连接入口，保留人工输入码。

- [x] 写浏览器授权、取消、超时/过期、插件重载、旧服务404后备测试：
```ts
// 成功授权后把 code 交给现有 connect，不改变同步数据。
expect(result.state).toBe('connected');
// 公共返回和授权链接不得含 deviceCode；取消/卸载不再继续连接。
// 5s 轮询与服务端 slow_down 生效，失败重试不启动第二个 loop。
```
- [x] 跑聚焦测试 RED。
- [x] 新增“连接 AgentWiki”主操作和授权进度；默认地址/高级自建地址；可打开浏览器和复制授权链接；后备链接到当前服务器指南并解释一次性码用途/10分钟期限。
- [x] 将 pending device secret 放现有 SecretPort，持久化恢复元数据；使用本地环境安全 URL 校验。完成后进入空间选择与已有映射流程。
- [x] 运行插件 format/lint/typecheck/tests/build/bundle 门禁。自审提交 `feat(obsidian): connect through browser authorization`，报告可供真实新 Vault 验收的产物绝对路径。

### Task 4: 网页接入入口、授权页与 Agent 提示词

**Files:** `agentwiki/apps/client/src/features/guide/{ObsidianGuide,ObsidianConnectionPanel}.tsx`、`features/about/{OnboardPage,OnboardDevicePage}.tsx`、navigation/dashboard 适用入口、`config/localSync.ts` 仅在集成人指定版本后改、messages/tests。

**Interfaces:** Consumes Task1 public session discriminants and Task2 exact JSON CLI. Produces complete bilingual user flows and copied Agent prompt.

- [x] 写入口首屏、授权 context 保留、Obsidian/Agent purpose 语义、过期重试、各客户端复制内容测试并确认 RED。
```tsx
expect(screen.getByRole('heading', {name:'连接 Obsidian'})).toBeVisible();
// 不把 Obsidian 连接解释为创建 Agent；复制提示词不得要求持久 stdin 或必填扫描路径。
```
- [x] Obsidian 首屏直接连接/安装/后备码，插件旧导航文字与页面一致；引导回插件发起浏览器授权，不制造相反操作链。
- [x] Agent 页面选择客户端、复制完整 steps 提示词，驱动授权→按名称选择空间/权限→确认配置→实际 MCP 读验证；显示导入可稍后进行和真实失败恢复。
- [x] 运行相关 client spec、typecheck 和 client build，记录桌面/390px 验收路线。自审提交 `feat(web): make connection setup discoverable and verifiable`。

### Task 5: 跨仓集成与真实验收

**Files:** docs/verification 新记录，候选打包与专用 test fixtures，必要版本契约由集成人统一处理。

**Interfaces:** 集成 Tasks1–4 经独立审查的提交；禁止把尚未发布 npm 版本当公开可安装版本。

- [ ] 主仓分项合并到集成分支，按顺序安装/构建 shared/protocol/server/client/local-sync，不并发修改 dist。
- [ ] 各任务独立审查（规格+代码）并回归修复；最终整分支/跨仓安全与可恢复性审查。
- [ ] 单独本地 DB、Redis namespace、test home、test Vault 启动候选；实际浏览器授权并验证身份/过期/取消/回读。
- [ ] 真实 Obsidian 新 Vault 从连接按钮到空间选择、映射；真实 Agent 消费完整提示词到宿主 MCP 读取合成知识；保留截图、脱敏输出、失败历史与精确清理清单。
- [ ] 全仓必要 test/lint/typecheck/build 和插件 check；记录本机无法覆盖的原生客户端，不拿模拟测试补造证据。
- [ ] 更新本任务 brief/decisions/refs、当前项目状态，给出已实现/已测试/已安装/未发布的准确边界及可审查产物。
