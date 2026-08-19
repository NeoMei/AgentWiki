# CodeGraph 标准扫描切换验证

验证日期：2026-08-19。

## 已验证范围

`AGENTWIKI_CODEGRAPH_E2E=1` 会运行独立安装的 CodeGraph 验收；未设置时，该测试以明确的 skip 退出，不会把 skip 当作通过。

本机本次诊断环境为 Node `v24.18.0`、CodeGraph `1.5.0`。版本仅作为诊断记录：测试和产品代码均不维护 CodeGraph 精确版本白名单，也没有 `@colbymchenry/codegraph` 依赖。

真实扫描 fixture 的证据链为：只读计划（`agentwiki-local-scan-plan@1`，64 位本地计划哈希）→ 显式传入相同计划哈希确认 → 真实 `codegraph init` → `agentwiki-code-snapshot@1` → 确定性 Markdown/SourceArtifact → `knowledge-bundle@1` Preview → 独立的同步确认 → 受控远端 review/publish。

- 确认计划前，fixture 不存在 `.codegraph/`；计划本身没有仓库写入。
- 确认后，真实 CodeGraph 创建索引并产生 1 个规范化文件记录（`src/index.ts`）；该标准快照的模块、符号和关系数据集均为空。
- 基于文件名和元数据的标准分析生成概览及入口点知识；测试验证生成物进入 `agentwiki-codegraph-generated` SourceArtifact 和 `knowledge-bundle@1` provenance。
- 预置的历史样式概览没有可验证的 legacy ownership marker，因此在 Preview 中保留、产生稳定不透明 migration-candidate warning 且不产生 deletion；在单独调用同步确认前没有任何远端 push。

远端 review/publish 采用受控 `RemoteSync` seam，因为仓库没有一次性 AgentWiki 审核服务 fixture。该 seam 只接收已确认的本地 Preview bundle，并返回 `published`；它不是线上服务通过的声明。扫描、快照、生成和 Preview 均使用真实本机 CodeGraph/本地流水线。

## 隐私审计

E2E 在 fixture 源码中放置了唯一的假凭据 canary（绝非真实 secret），并在 provider 的本地环境中放置了另一个唯一诊断 canary。测试先验证这两个 canary 确实存在于各自的受控本地输入，再对 snapshot、Preview 和受控 publish bundle 的合并输出逐项检查以下精确值均未出现：临时绝对根、fixture 原始正文 sentinel、假凭据 canary、本地诊断 canary、`.codegraph/codegraph.db`、CodeGraph 可执行文件路径和其环境变量名。canary 没有被人为注入待审计输出。测试不读取 SQLite，也不上传原始源码、数据库、二进制、凭据或本地诊断。

## 三客户端接入

状态机 E2E 为 Codex、Claude Code、OpenCode 分别创建独立临时 home。每种客户端都运行真实 onboarding coordinator 和事件派生的两次确认，使用 `standard` 计划/准备路径并且不转发 deep。持久化的公开 `displayPath` 使用与网关相同的严格相对路径契约；绝对路径、Windows 路径、遍历、反斜杠、空段和全部 Unicode Cc（含 U+009B）均在任何计划、bootstrap、prepare 或 sync 前拒绝，且失败事件不回显该路径：

同一校验也适用于 live provider 在初始 `confirmPlan` 与 `firstScan` drift replan 返回的计划：转换/严格 schema 必须在 Preview 和 confirmation 事件之前运行。无效 live plan 只产生稳定的 `local CodeGraph scan plan is invalid` 失败，不生成 `confirmation_required`，不写入原始路径，也不触发 bootstrap、prepare 或 sync。

1. 首次确认绑定服务器计划哈希与本地扫描计划哈希；
2. 完成 Preview 后，以独立确认调用同步；
3. 受控 bootstrap 使用生产配置写入器，只在该临时 home 写入唯一的 `agentwiki` MCP entry；断言没有第二个 AgentWiki 或 CodeGraph MCP entry。

三客户端内部 driver 与外层 wrapper 提供两类互补证据：内部 driver 验证真实 coordinator 与生产配置写入器；外层 `runOnboardingHarness` 的受控 child/fetch 用例验证临时 root/home、NDJSON 输入及确认回复、完成报告、子进程终止、三类资源删除和根目录清理。错误用例验证主协议错误不会被清理错误覆盖，而成功后的清理错误仍会传播。远端授权、bootstrap 和发布在两层测试中仍是受控依赖，故不把它描述为真实远端服务验收，也不会访问真实 home 或网络。

## 命令与结果

```sh
AGENTWIKI_CODEGRAPH_E2E=1 pnpm test:e2e:codegraph-standard-scan
# 1 passed, 0 skipped

node --test scripts/onboarding-e2e.test.mjs
# 8 passed
```

完整矩阵、静态审计和最终工作树清单在本任务的 SDD 报告中记录。Stage 2 深度分析未实现，也不会由标准路径隐式触发。

## 最终并发加固（Task 3）

已将同一源的一致性边界从确认后的 scanner 执行延长到快照验证、确定性分析、generated base 写入、批次发布和 SourceArtifact 适配全部返回。`withConfirmedSnapshots` 在锁内重新规划并核对计划哈希及可执行文件身份；它按 `sourceKey` 的代码单元顺序获取租约，并按相反顺序释放。回调仅接收已验证、深冻结的快照副本，不会重新读取可被另一扫描替换的 `current` 快照。

受控真实交错 RED 先证明旧路径的缺口：A 已将快照 A 落盘、旧 `execute` 返回并释放租约后，B 在 A 适配前进入第二次真实 `sync`。GREEN 使用相同的真实临时目录、快照存储和 runner barrier，证明 B 在 A 适配返回前无法执行或发布，且 A 的 artifact `sourceId` 仍是 A 的已确认快照哈希。额外 barrier 覆盖不同 source 可并行、反向多源输入完成且不死锁、以及回调获得不可变快照。生成发布层的真实批量用例还验证 consumer 失败时所有已提升 publish 回滚为先前完整集合且不返回 artifact。

最终冻结代码在允许 loopback 的运行器上完成 `pnpm test`：runtime 72 pass / 40 个缺少 `DATABASE_URL` 的显式 skip、server 535、client 157、sync-protocol 22、local-sync 718，合计 1,504 pass、0 fail。此前受限的 4 个 HTTP integration suites / 20 tests 已实际执行，不再是环境缺口。

Node 26 证据使用从 Node.js 官方发布目录下载并按官方 `SHASUMS256.txt` 校验的临时 `v26.7.0` Darwin arm64 二进制。`scripts/node-runtime-contract.test.mjs` 21/21 与 local-sync 59 files / 718 tests 均在该运行时通过；临时二进制目录随后删除。Node 24 的完整矩阵、真实 CodeGraph 和三客户端证据同样保持通过。

### Task 3 reviewer remediation

扫描后的稳定状态现在要求 `initialized=true`、`state=complete`、`pendingRefs=0` 且 `pendingChanges=0`。若 `sync` 后仍有 pending change，或 scanner 在同步后再次变更，流程以稳定的 `CODEGRAPH_INDEX_INCOMPLETE` 在快照、回调和生成发布之前失败；该错误不公开本地源路径。回归还在已有真实 publish 的前提下验证此失败保留 publish。

同源 barrier 已改为真实 `CodeSnapshotStore` 和包内部真实 `GeneratedKnowledgeStoreCore`：A 分别在真实 batch consumer 内部、以及适配已返回但 provider callback 尚未释放租约时暂停。B 已实际请求同源锁，但在两个可观察 barrier 下都不能进入 scanner mutation、`writeBase` 或 `withPublishedBatch`；释放后 B 完成。A/B 的 SourceArtifact `sourceId`、Markdown 中的 snapshot hash、ownership metadata 与真实 publish manifest 均按各自确认快照逐项核对。

`ConfirmedCodeSnapshot` 的外层数组、每个项目和嵌套快照都是不可变的。测试覆盖数组 push/reorder/replace、项目的 sourceKey/hash/files 赋值，以及 manifest/files 深层赋值，均抛错且不改变值。每个 source 的本地 `current` 仍表示该 source 最新完整扫描；多源运行中较后 source 失败不会制造 generated/artifact 混合事务，但不会宣称回滚已确认的外部 `.codegraph` 动作，也不要求已完成较早 source 的 `current` 回退。
