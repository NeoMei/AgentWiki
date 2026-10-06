# 检索验收短暂失败调查

日期：2026-10-07。只读调查源码与脱敏回执，未修改产品、未启动服务、未运行模型或测试。调查源码 HEAD 为 `66f8a68ab798cabae960dfb3718bdddb02a552aa`，typed read-tool 实现提交为 `60de66027db3beb91fb32fbb864afd3f8ad443a1`。下文文件路径相对 `agentwiki/`，时间按原始 UTC 回执书写。

## 结论与证据边界

root 的一次定向时序复播重现了 B 的同类四次失败，脱敏 HTTP 记录确认都是 HTTP 429 / `AUTH_RATE_LIMITED`。全局 `RateLimitGuard` 的每凭据每分钟 120 次 HTTP 请求门槛，与复播的首次失败计数完全吻合。旧验收 facade 每执行一条命令就重启 stdio gateway，从而把正常网关启动时的一次工具发现重复到每条知识调用；这是本次验收额外流量的具体来源。

原实验没有保存成功生命周期内的 API 日志，故不能声称已读取原实验的 429 响应。原实验的错误形态、同一分钟中 B 调用数较多而 A 正常、分钟边界后恢复，与复播已确认的机制一致。复播是根因诊断证据，不是新模型验收，不能替换原分数、原失败数或原答案。

## 原实验时序

证据：`/tmp/agentwiki-knowledge-20261007/knowledge-retrieval-evidence-e4IML9/trace-{a,b}.jsonl`。

| B 时间 | 调用 | 结果 | 操作 / 含网关启动耗时 |
| --- | --- | --- | --- |
| 19:47:41.437 | search_pages | 成功 | 17 / 164 ms |
| 19:47:44.386 | search_pages | `REMOTE_UNAVAILABLE`, `cachedToolCount:23` | 4 / 130 ms |
| 19:47:47.417 | search_pages | `Tool wiki_search_pages not found` | 1 / 112 ms |
| 19:47:50.983 | get_page | `Tool wiki_get_page not found` | 1 / 111 ms |
| 19:47:57.168 | list_pages | `Tool wiki_list_pages not found` | 1 / 111 ms |
| 19:48:00.528 | tools/list | 成功，六个允许的读取工具 | 3 / 130 ms |
| 19:48:03.256 | get_page | 成功 | 21 / 148 ms |

A 在 19:47:52.411 的 list_spaces 成功；这是故障区间内的一次实际成功采样，不能扩述为每个时刻都健康。四次 B 回执的 `transportSuccess:true` 只表示 facade→本地 SDK 返回了结果，不代表远程 HTTP 成功。毫秒级失败不支持 30 秒握手超时或 45 秒 facade 调用超时假设。

## 定向复播与计数

root 在独立自有 harness 中复播实际 a/b 工具调用时序；没有模型参与。临时 wrapper 仅记录 method、RPC method、status、错误类型/业务码等字段，不记录凭据或业务正文。只读核验的证据为：

- `/tmp/agentwiki-knowledge-20261007/diagnostic-replay/fetch-a.jsonl`
- `/tmp/agentwiki-knowledge-20261007/diagnostic-replay/fetch-b.jsonl`

B 的首次 429 为 19:52:47.110，所在 gateway 进程的第 7 次 fetch，即启动发现成功后，业务调用的新 `initialize` 请求；随后 19:52:50.141、53.715、59.889 都在新 gateway 的第 1 次 `initialize` 得到 429。四次业务码均为 `AUTH_RATE_LIMITED`。19:53 的请求恢复。

首次 429 之前，B 恰有 120 条非 `notifications/cancelled` HTTP 尝试：30 initialize + 30 initialized notification + 30 GET + 16 tools/list + 14 tools/call。随后第 121 条为失败 initialize。19:52 同一分钟 A 有 100 条非取消 HTTP 尝试、12 次成功 tools/call，没有 HTTP 429；B 有上述 120 条加四次 429。计数是 fetch 侧观测，不伪称 Redis 桶快照。

GET 中部分最终显示客户端 `AbortError`，并不证明请求未到服务端；在首次失败前 B 有 8 个这样的 GET。另有 `notifications/cancelled` 全部以 `AbortError` 结束，不将它们计为已消费的服务端请求。已确认的 120 次门槛与非取消请求数吻合，无需假设取消请求也计入来解释失败。

## 代码解释

1. `apps/server/src/core/security/security.module.ts:14` 将 `RateLimitGuard` 注册为 `APP_GUARD`，`app.module.ts:39` 导入它。并非 MCP 模块内的专用限流入口。`rate-limit.guard.ts:20–53` 对非 `/api/auth` 路径先消费 IP 桶，默认 300/min，再按 Bearer `agk_` / `awk_` 或 X-API-Key 的哈希消费 120/min 凭据桶。桶号为 `floor(Date.now()/60000)`；Redis TTL 为 61 秒，超过上限抛 `AUTH_RATE_LIMITED`，由 `core/filters/business-error.ts:20` 映射为 429。该业务码名称不意味着登录或凭据失效。Redis 不可用时有进程内 fallback，见 guard:91–95、115–135 和 `database/redis.service.ts:325`。
2. `scripts/knowledge-retrieval-agent-client.mjs:77–116` 每次 `runConsumer` 新建 Client + StdioClientTransport，执行一条命令后关闭。stderr 被消费但丢弃。`scripts/knowledge-retrieval-harness.mjs:157–173` 的 wrapper 每次进入 `runCli(['gateway',...])`，因此旧 facade 没有跨命令存活的网关或内存 manifest。
3. `packages/local-sync/src/gateway/entry.ts:140–143` 每次启动先构建 gateway；`server.ts:183–218` 在启动时调用一次远程 listTools，然后固定注册发现到的 wiki 工具。正常持久 stdio 客户端启动一次，不会为每个本地 tools/call 再运行这段注册流程。
4. `remote-mcp-bridge.ts:134–162` 在每次 discover **以及每次 business call** 新建远程 SDK Client/StreamableHTTP transport。实测每次远程操作约产生 initialize、initialized notification、GET、tools/list 或 tools/call 四个 HTTP 请求；Abort 引起的取消尝试另列。旧 facade 的每条正常业务调用于是包含 startup discovery 四次 + business 四次。最初纯 tools 命令也产生四次发现请求。14 次成功调用后，下条 startup discovery 恰把 B 的总数推进到 `4 + 14×8 + 4 = 120`，其 business initialize 被拒绝。
5. `remote-mcp-bridge.ts:71–83` 发现失败返回内存 cache 或空数组。首次失败时已发现 23 个工具，业务 `initialize` 的 429 被 :86–101 通用映射为 `REMOTE_UNAVAILABLE`。后面每次 facade 启动都是空 cache，startup discovery 429 返回空数组，因此没有注册任何 wiki 工具，本地 SDK 报带 `wiki_` 前缀的 Tool not found。读参数 normalize 尚未执行；不是 Task2 命名参数丢失复现。`server.ts:80–99` 的 onboard_status 能报告恢复/需重载，但不会动态补注册工具。
6. `apps/server/src/mcp/mcp.service.ts:126–142` 每个 HTTP 请求建立并关闭服务端实例，`sessionIdGenerator:undefined`，没有需续期的服务端 MCP session。`core/auth/combined-auth.guard.ts` 每请求验证 bearer，`auth.service.ts:76–150` 读凭据状态并更新 lastUsedAt。没有从本次回执得到凭据撤销/过期证据；429 来自认证之前的全局 guard。Bridge 明确区分 401/403，当前未明确区分 429。
7. `scripts/knowledge-retrieval-harness.mjs:48–69` 仅在内存保留滚动 API 输出；:253–264 的成功清理只复制 facade traces，:265–269 只在外层失败时写 failure-diagnostic。解释了为什么原实验无法倒查具体 HTTP 错误。

## 最小修正方向与复验

root 已决定先修验收 facade，使每个消费者拥有一个持久 stdio 连接，与正常 MCP 客户端语义一致。保持 a/b 的 Credential、home、连接与结果隔离；模型仍只能发相同六种只读操作、原样参数。不要提高/关闭限流，不替换原实验记录，不修改检索算法或把错误自动重试藏进成功计数。

验收封装需补的结构测试：多条命令复用同一个 gateway；真实 SDK 命名字段/原样参数/错误回执保留；并发 a/b 不共享身份；连接失败与退出清理可追踪；harness 关闭后无持久消费者子进程。现有入口是 `scripts/knowledge-retrieval-harness.test.mjs` 的 actual SDK receipts、CLI actual stdio、cleanup 与 owned-process tests。

修正后先用同样固定工具时序与脱敏 HTTP 元数据作最小协议诊断，再以同一个新 harness 版本分别重跑 baseline a/b 与 candidate a/b，保存源码/构建/技能哈希与清理回执。新旧方法不同，不能只替换 candidate 而沿用旧 baseline 成本。保持原失败与本次 429 证据用于解释方法差异。

持久 gateway 仍使用当前产品 RemoteMcpBridge 每个 business call 新远程 Client 的实现。单 Space、一次发现、20 次业务调用按本次观测约 84 条非取消 HTTP 请求，而旧 facade 约 164 条；这是请求形态推算，不是已完成的新运行结果，也不保证更高频调用永不触发限流。多 Space 的发现与 list_spaces 聚合还会增加请求。连接复用、池化、全新限流策略均不属于本期。

可独立记录后续产品诊断改进：把远程 429 识别为安全且明确的受限状态，避免误导为服务不可用；保留启动发现失败原因，使空目录不会只留下 Tool not found。现有 `remote-mcp-bridge.spec.ts` 覆盖 401/403/503、缓存与超时；`server.spec.ts` 覆盖 offline、恢复需重载；`rate-limit.guard.spec.ts:233–264` 已覆盖 120 次凭据桶与 Bearer 等价。是否实施诊断改进应单独确定范围，不以放宽限流或自动重复业务调用解决本次问题。

本调查只新增本报告，没有修改上述源码、配置、凭据、语料、评分或运行资源。
