# Post-sync final audit — 2026-09-05

## 结论

Mac 合并候选 `206d285fc28e76c16e436baf6533ace3bebdaade` 达到本地交付门槛：任务清单、合并语义、代码差异、真实 PostgreSQL/Redis、前后端、同步协议、本地同步包、真实 Chrome 桌面/390px 交互、类型、Lint、生产构建、依赖审计与真实 CodeGraph 均完成重复审查，最终没有遗留值得修复的 finding。

这是 **Mac 本地候选 PASS**，不是发布状态：本轮没有 push、npm 发布或生产部署；合并后的同一 SHA 仍需真实 Windows 11 x64 原生复验，Assist 成功路径仍需有效外部模型凭据。

## 基线与合并

- 原始 Mac 工作区有用户改动，整个任务在隔离工作树中完成，没有覆盖原工作区。
- 重新 fetch 后，Mac 本地线与 `origin/master@36e70c5` 分叉；远端 onboarding 热修复通过 merge commit `79ac85c` 合入。
- 本轮产品/测试修复提交：
  - `375d4a4` — `fix(onboarding): harden prompt and mobile guide verification`
  - `206d285` — `fix(sync): bound legacy revision writes`
- 代码候选之后只新增本验收证据提交；最终本地 `master` 相对 `origin/master` 为 ahead 38 / behind 0，未向 GitHub 写入。

## 多轮任务与代码审查

### 第一轮：远端 onboarding 合并语义

- 对完整 Agent 提示词、NDJSON stdin/stdout 状态机、首页复制入口、中英文文案和消费者 fixture 逐项比对。
- 发现 fixture 在真正输出 `confirmation_required` 前已经进入 `plan` 状态；Agent 若提前硬编码确认，测试会错误放行。
- 先新增失败用例并观察 RED，再让 fixture 在确认请求发出前拒绝输入；focused 4/4 通过。

### 第二轮：真实 UI 与异步测试稳定性

- 使用仓库 Playwright 驱动已安装 Chrome；Browser skill/plugin 本轮不可用，因此没有把 DOM mock 当成 UI 验收。
- 桌面 onboarding、复制内容、中文/英文、授权与轮询均通过；390px 截图发现指南侧栏在 flex 布局中把主内容从 358px 挤到约 70px。
- 新增持久 Playwright 回归并观察 RED，修复为移动端固定全屏遮罩；focused 2/2、最终全套 28/28 通过。
- 全仓复跑发现 Prisma query event 到达晚于断言的测试竞争；生产结果已经正确但查询计数偶发为 0。改为在固定 1 秒上限内等待预期事件后仍严格断言精确查询数，focused 连续 5 轮通过。

### 第三轮：干净工作树容量回归

- 首次干净工作树全量运行在 5000 页/100 MiB 边界触发 120 秒事务超时。
- 根因不是单纯超时配置：legacy writer 对每个新页面重复聚合最大 ordinal，形成二次方数据库工作量，并对相同正文重复写两个内容表。
- 先用单元测试证明旧实现一批两页会聚合两次并重复正文 upsert，再修复为每批惰性聚合一次、单调分配 ordinal、按 content hash 去重内容表 upsert。
- 单元测试 17/17；真实 5000 页/100 MiB 独立回归约 48.2 秒通过，5001 页原子拒绝约 37.6 秒通过。最终全量中的同两项分别约 48.7 秒与 46.5 秒通过。

### 第四轮：最终差异与遗漏审查

- `79ac85c..206d285` 仅涉及 7 个预期文件；逐项复核实现、测试和 UI 回归，没有额外未解释改动。
- `origin/master...HEAD` diff whitespace 检查通过；新增行未发现 TODO/FIXME/HACK/XXX 或未实现占位。
- 第一次干净全量的 6 个失败均在测试入口因错误显式 `schema=public` 被 fail-closed 拒绝；改用无 schema 的基准 URL 后，图并发、pgvector 4 项和关系并发均通过。这是测试环境配置错误，不是产品缺陷。

## 最终测试证据

最终提交在新建 detached clean worktree 中执行 `pnpm install --frozen-lockfile --offline`，随后使用任务专属 loopback PostgreSQL `55433`、Redis `56380/13` 运行 `pnpm test:full`：

| 阶段 | 结果 |
| --- | --- |
| Runtime | 209 pass / 1 skip / 0 fail |
| PostgreSQL/Redis DB | 146 pass / 0 skip / 0 fail |
| Server | 1855 pass / 1 skip / 0 fail |
| Client | 1122 pass / 0 fail |
| Sync protocol | 57 pass / 0 fail |
| Local Sync | 877 pass / 1 skip / 0 fail |
| 合计 | **4266 pass / 3 skip / 0 fail（4269 total）** |

数据库门禁强制零跳过；3 个仓库级预期 skip 分别属于非本轮强制的外部门禁/平台条件，不包含数据库逃逸。

真实 UI 验收使用同一实现候选的前端代码与本地 API/worker/client：

- Playwright + installed Chrome：9 个 spec、28/28 通过，约 47.1 秒。
- 覆盖登录、Space、Markdown、模板、协作、本地同步、onboarding 桌面与 390px 指南交互。
- onboarding 桌面/移动端额外检查剪贴板、中文/英文、console error、API 5xx 和页面横向溢出；修复后移动端视觉复核通过。
- `206d285` 相对 UI 通过提交 `375d4a4` 只修改服务端 revision writer 及其单元测试，前端产物没有变化。

独立门禁全部 exit 0：

- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`（只有既有 Vite `>500 kB` chunk warning）
- 裸 `pnpm audit`：`No known vulnerabilities found`
- CodeGraph 1.6.0 真实 standard scan：1 pass / 0 fail / 0 skip
- `git diff --check`

## 清理与边界

- 随机测试 schema、`aw_*_global_test_*` 数据库最终均为 0。
- Redis DB 13/14/15 最终均为 0；本轮两个 `agentwiki-postsync-*` 容器已停止并因 `--rm` 移除。
- 本轮临时 detached worktree 已删除，API/worker/client 已停止，3000/5173 无监听。
- 55432 属于另一个并行任务；清理后该端口对应容器仍在运行，本轮从未停止或修改它。
- 临时附件目录已移入废纸篓，可恢复；原始脏工作区未触碰。

## 尚未执行的独立动作

- 将本地 38 个提交 push 到 GitHub。
- 基于 `206d285` 重新完成真实 Windows 11 x64 原生验证。
- npm 发布、生产备份/迁移/部署与公网验收。
- 使用有效外部模型凭据完成 Assist 成功路径。

这些动作需要各自的授权或外部条件，不影响本轮 Mac 本地代码候选 PASS，但不能被描述为已经发布或生产完成。
