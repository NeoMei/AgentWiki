# 内置 Agent 自动编辑失败修复（2026-10-24）

v0.12.59 已部署，冻结源码为 `69520f568f2e1a1682eebcc46d858fe2475b8065`；上线后实际生产路由与真实 Qwen 的随机来源标记验收通过。用户贴出的原 Bug 汇总页没有被本轮验证改写。

## 问题与证据

用户要求根据目录全部测试报告更新当前「Bug 状态汇总表」，多轮失败；随后 Agent 声称会话只读、没有写权限。

- 生产只读任务元数据确认：会话使用 `mode:auto`，发起者当前角色为 `editor`，最近任务包含 9 篇目录文档。没有证据支持“会话永久只读”的解释。
- Worker 记录的主模型错误为 `invalid_output`，随后免费备用模型出现 `auth_failed`。备用模型认证问题不等于用户没有页面编辑权限，本补丁没有修改任何认证配置。
- 使用同一生产外部 OpenCode 2.1.1 和 Qwen 配置、仅传合成数据，复现决策返回完整 JSON 代码围栏而被旧解析器拒绝。该版本可能在最后文本后直接 EOF，没有 `step_finish`。
- 修正格式解析后，真实模型仍未读取目录，出现凭空汇总或只宣布准备读取。独立回环 provider 捕获到首个业务请求 `tools=0`。
- 同一进程稍后两个工具出现并能读取快照，确认 OpenCode v2 的 MCP 异步初始化先于工具注册完成放行模型请求。官方 [prompt hook](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/core/src/session/prompt.ts#L37-L51) 和 [工具注册流程](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/core/src/tool/mcp.ts#L133-L144) 与实测一致。

## 最终改动

1. 意图判断只增加当前绑定页面/目录的标识和标题，用于识别用户点名当前文档的更新请求；正文、历史与工具结果仍不进入授权判断。
2. 兼容单个完整 JSON 代码围栏；不从任意文字提取 JSON，不修补截断内容，不放宽 action、字段、权限和目标约束。
3. 自动模式只接受最后一个助手步骤，支持最终 EOF；前言、工具步骤、空末步和截断末步不能回退为早先候选。聊天正文也只在最终验证后发送。
4. 仅为 OpenCode v2 的目录生成请求创建临时 readiness 插件。`prompt` hook 等实际工具注册，`context` hook 验证两个直接工具在模型上下文中并写私有能力回执。成功退出但缺少有效回执时拒绝结果。等待沿用执行截止时间和进程取消机制；临时目录随执行清理。
5. 提示词明确区分本轮 `answer` 和会话权限；目录读取工具只读、shell 禁止与应用保存页面是不同能力。要求基于全部报告的请求先完整读取，不得编造来源或失败原因。

没有放宽模型工具权限。业务正文仍由应用在真实用户权限、绑定目标和版本检查后保存。

## 验证

- Server 全量：**3593 passed / 44 skipped**，183 套通过、7 套专用环境测试跳过。不是全仓 `test:full`。
- 定向独立复核：readiness / runner / auto-response 三套 **145 passed**。
- 服务端 typecheck、6 个变更 TS 文件 ESLint、server build、`git diff --check` 通过。
- 新增用例均保留先失败再通过的验证：JSON 围栏、最终步骤与 EOF、输出截断、能力回执缺失/无效、工具延迟就绪/超时/丢失及临时文件权限。
- **真实 Qwen + 生产同版 OpenCode 2.1.1 合成验收通过**：原中文意图判定 `update`；目录枚举 1 次、文档读取 9 次；最终替换 Markdown 包含全部 9 个只存在于来源正文中的唯一标记及对应页面链接。其他绑定页、viewer、明确聊天输出分别判定 `answer`。[回执](./live-provider-receipt.json)
- 外部 CLI 回环 provider 的延迟就绪、初始化失败、取消、超时验收：本机 2.1.4 和生产同版 2.1.1 均 4/4 通过。正常项延迟 MCP 启动 3 秒，首个业务请求即含两个工具并读取全部9篇；负向三项均0业务请求、0接受更新。初始化失败按总超时结束。见 [本机回执](./readiness-local-receipt.json) 和 [生产同版回执](./readiness-production-runtime-receipt.json)。

## 复现命令

```sh
pnpm --filter @agentwiki/server build
node docs/verification/agent-auto-edit-20261024/readiness-runtime-probe.cjs --opencode /absolute/path/to/opencode
node docs/verification/agent-auto-edit-20261024/live-provider-probe.cjs --candidate
# 部署后运行实际路由（含模型选择、同一截止时间和一次格式重试）
node docs/verification/agent-auto-edit-20261024/live-provider-probe.cjs --router
```

真实 provider probe 使用已配置 provider，只发送合成资料；候选模块仅载入诊断进程内存，不替换生产文件、不写业务数据库。回环 probe 使用假 key 和本机 HTTP fixture，不向真实 provider 发请求。

## 边界

本轮没有运行真实用户浏览器的保存流程。权限/CAS/写入路径由现有服务端回归覆盖，真实 Qwen 验收止于已验证的更新内容。真实原始 9 篇报告的业务结论未在本轮重新汇总。免费备用模型认证失败仍属独立运行环境问题。

## 发布与恢复

- 从干净 detached checkout 运行部署；实际归档1425文件与冻结清单完全一致，无多余/遗漏/hash差异。
- 生产1425源码、三包0.12.59、三项用户服务、五项health及公网HTML/5入口资源核验通过；65迁移已应用，pending0/failed0。
- 新配对备份 `/var/backups/agentwiki/agent-auto-v01259.z755u0mq` 对应发布前0.12.58 / 19da88eb / 1423源码。独立10/10校验通过；写服务暂停约10.6秒后恢复。应用、配置、数据库、完整附件配对，未做恢复演练。
- previous应用树 `/root/agentwiki-previous-20261024043922` 保留。恢复须配套数据库、配置、附件并考虑备份后写入，不能只切回旧应用树。
- 配套回执：[发布输入](./deployment-input-receipt.json)、[配对备份](./backup-receipt.json)、[主机](./production-host.json)、[公网](./production-public.json)、[独立运行状态](./production-runtime-receipt.json)。

## 上线后真实 provider 复验

单次 `runModel` 初验读完9篇，但最终文本含额外说明+JSON围栏，被严格格式校验拒绝；原始失败记录保留在 [单次回执](./live-deployed-single-attempt-receipt.json)。未放宽解析器。

随后诊断脚本增加 `--router`，调用线上实际 `OpencodeModelRouter`、模型目录和配置，覆盖生产两阶段决策、统一执行截止时间以及既有最多一次格式重试；[完整路由回执](./live-deployed-router-receipt.json)通过，成功模型为 `bailian-coding-plan/qwen3.7-plus`。

诊断的模型健康状态保留在进程内，不修改共享Redis熔断状态；它不能替代队列运行、真实用户权限/CAS/保存及浏览器验收。后续增强版使用每篇独立随机UUID标记，并按生产ASSIST_LEASE_MS提供租约上限，防止根据连续编号补齐结果。


[增强随机来源验收](./live-deployed-random-router-receipt.json)最终通过：线上部署模块、真实catalog/config/router、Qwen主模型、300秒请求预算与360秒租约；最终update完整包含9个各文档正文独有的随机UUID标记。其他绑定页、viewer与明确聊天输出均answer。该轮一次生成完成，未触发格式重试；格式重试路径仍由既有单测覆盖，不把前一次单次失败记录伪称为本轮自动重试成功。

GitHub Release：https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.59
