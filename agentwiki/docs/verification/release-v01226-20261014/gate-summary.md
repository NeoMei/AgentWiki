# AgentWiki 发布前门禁回执

日期：2026-10-14（Asia/Shanghai）。测试起点 `afc579c9`；版本改动后相关门禁已重跑。工作树 `/Users/neomei/.codex/worktrees/agent-identity-space-auth/AgentWiki `。本回执仅包含本地非数据库验证，不能代替生产部署、真实数据库和 npm 正式发布回执。

| 门禁 | 最终结果 | Exit | 日志 |
| --- | --- | --- | --- |
| runtime 非DB（升版本后） | 309 pass / 1 existing skip / 0 fail | 0 | runtime-nondb-release-final.log |
| server 非DB | 172 suites / 3132 pass / 28 skip / 0 fail | 0 | server-nondb-test.log |
| client 完整回归 | 151 files / 2467 pass / 0 fail | 0 | client-test.log |
| client 升版本后定向回归 | 9 files / 77 pass / 0 fail | 0 | client-version-tests-final.log |
| sync protocol | 10 files / 140 pass / 0 fail | 0 | protocol-test.log |
| Local Sync（0.13.0完整回归） | 71 files / 998 pass / 1 existing skip / 0 fail | 0 | local-sync-test-final.log |
| typecheck | server、client、protocol、local-sync 全部通过 | 0 | typecheck.log |
| lint | server/client/local-sync 全部通过 | 0 | lint.log |
| 全项目 build | shared→protocol→server→client→local-sync 串行通过 | 0 | build.log |
| git diff --check | 无空白问题 | 0 | 终端回执 |

各次尝试时间、命令阶段和 exitCode 见 `gate-results.json`。77 项定向客户端和29项定向锁测试均为已有用例复跑，不重复计入完整测试总数。

## 未计为通过的项目

- server 28 skip 中有24个依赖真实数据库的用例，本轮没有给它们数据库环境。发布前由DB agent补 `node scripts/server-test-harness.mjs run`，其余4项属于既有skip。
- runtime 1 skip：未启用 `AGENTWIKI_CODEGRAPH_E2E=1` 的真实独立 CodeGraph 安装验收。
- Local Sync 1 skip：Windows ACL 平台限定测试，在macOS不运行。
- npm clean-install/registry-parity、真实 PostgreSQL/Redis、生产迁移及UI回验由root与其他agent接续，未记入本回执。
- Vite构建保留既有超过500KB chunk提醒；构建成功，无新增构建错误。

## 首次失败与修复

1. 初次 server-test-harness 未配置 COLLABORATION_TEST_DATABASE_URL，被安全前置门禁拒绝，未运行测试。保留 `server-test.log`；按分工改用server非DB用例，真实DB由独立agent补。
2. 初次 Local Sync：997 pass / 1 fail / 1 skip。旧 `source-lock.spec.ts` 遗留残留清理测试的存活注入只认可pid777，错误地把本测试的自身pid判死；并行IO延迟超过100ms时，自身ticket可被视为dead清掉，随后超时。
   - 无修改定向29/29通过，说明负载相关。
   - `/tmp/agentwiki-release-20261014/diagnose-source-lock.mts` 直接使用生产SourceLock推进模拟时钟200ms，旧stub必然超时，认可自身pid则成功。结果在 `source-lock-diagnosis.log`。
   - 按root授权只修改该测试用例的存活注入为 `pid === process.pid || pid === 777`，保留dead fixture、live fixture和全部清理断言。没有改生产锁代码。
   - 修复后定向29/29与0.13.0整包998/1skip均通过；原始失败 `local-sync-test.log` 保留。
3. 升版本后runtime门禁检出3个0.12.0残留发布面：client的两份e2e和server env example。root修复后309/1skip通过。失败日志 `runtime-nondb-final.log` 保留。
4. 升版本后client定向发现LocalSyncInstallCard测试helper正则仍匹配0.12.0，造成6例失败；root修复正则后77/77通过。失败日志 `client-version-tests.log` 保留。

## 发布影响

- Web/server/client：0.12.25 → 0.12.26。包括编辑器选区、图片预览、共享笔记/侧栏、Agent聊天简化和Space Owner。
- Local Sync：0.12.0 → 0.13.0。新增gateway四个PageNote工具直参schema与真实MCP SDK转发验证，属于兼容新增功能，需发npm包；生产服务器本身的新MCP工具不等于客户端npm网关已更新。
- Sync protocol：0.6.1不变。`v0.12.25..HEAD`无协议/共享包源码变更，无protocol新发布必要。
- 运行时协议/ABI未变；scripts产品差异主要是PageNote真实DB测试与已有schema清理适配。版本契约表面统一到0.13.0，仍保留0.12.0客户端兼容测试。
- 生产必须执行 `20261014220000_shared_page_notes` 迁移（PageNote新表、作者/状态约束、页面复合外键、幂等唯一索引和列表索引）。
- npm clean-install脚本会触发prepack并重建server；不得与真实DB套件并行执行，以免清空dist影响已运行服务。
