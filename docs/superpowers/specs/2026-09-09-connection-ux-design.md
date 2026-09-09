# 接入体验根本改造

用户于 2026-09-09 明确同意上一轮方案并要求从根本上解决问题。本文件把已确认方向落实为跨仓契约，实施继续，不增加重复方案审批。

## 目标与边界

- Obsidian 默认由插件发起浏览器授权、自动完成设备连接，再选择空间和本地文件夹；手动连接码保留为兼容后备。
- Agent 继续通过复制完整提示词接入，但默认不依赖长驻 stdin 进程；提供有界、持久化、可恢复的分步命令。
- 基础连接不要求 sourcePaths、不扫描、不上传；知识导入作为连接成功后的独立可选动作。
- 真实客户端实际读取是验证成功的证据；网关配置完成、工具握手、宿主加载、实际读成功分别报告。
- Folder/Page、目录权限、CAS、treeRevision、同步协议、现有迁移和生产内容保持。旧 NDJSON/human/一次性 code 流程兼容，不冒用 Agent token 作为人类 Obsidian 凭据。
- 不更换组件体系；网页中英文、持久化语言、桌面/390px 使用均需验证。所有私有凭据不进源码、报告或模型输出。
- 三条发行链独立。实施可本地提交和集成；本轮先做完整候选及验收，公开发布/生产部署在可审查结果完成后按有效授权决定。

## Obsidian HTTP 契约

使用现有 OnboardingDeviceSession 存储设备授权生命周期，新增 purpose `obsidian-connect`、clientType `obsidian`，只授权连接当前人类账号；不得授予 bootstrap Agent/Space 能力。不新增数据库 schema。

1. `POST /api/integrations/obsidian/device/start`，公开，body `{pluginVersion:string}`。响应 `{deviceCode,userCode,verificationUri,verificationUriComplete,expiresIn,interval}` 与现有设备授权返回结构相同；600 秒有效、默认 5 秒轮询。deviceCode 高熵且只留插件，URL 仅带 userCode。
2. 复用 `GET /api/onboard/device/session?userCode=...` 和 JWT 保护的 `POST /api/onboard/device/decision`，响应公开 session 的 clientType/purpose/status/expiresAt 足以让页面区分 Obsidian 与 Agent。用户在浏览器显式批准或拒绝。
3. `POST /api/integrations/obsidian/device/poll`，公开，body `{deviceCode}`。响应 `{status:'authorization_pending'|'slow_down'|'denied'|'expired',interval?:number}` 或 `{status:'authorized',code:string,expiresIn:number}`。code 为现有 exchange 可消费的一次性安装连接码，绝不在浏览器返回。用现有 installation 与 exchange/activation 服务完成连接。
4. 对设备轮询丢包和并发重试保持幂等：同一有效设备请求只能对应一个安装授权；重试可取回相同短期 code，不能生成无限授权。可由仅握有 deviceCode 的调用方和服务端稳定规则派生重放值，服务端仅存 hash。具体算法和现有 code 格式兼容，并通过独立安全审查。
5. 所有调用重查期限、人类账号 active 状态、purpose。Agent poll/bootstrap 不得消费 Obsidian purpose；Obsidian poll 不得消费 Agent purpose。速率限制、并发批准/拒绝 CAS 和审计保留。公开 session 不返回 token/code/user 身份。
6. 插件 start 后持久化 secret-store 中的设备秘密，打开服务端给出的同源可信 HTTPS 授权链接（开发仅允许 loopback HTTP），轮询时遵守 interval/slow_down；取消、过期、失效显示重试入口，settings 重绘/插件卸载终止旧轮询且可恢复待处理授权。默认官方地址，自建地址可配置。
7. 手动连接码仍可用，说明用途与有效期并直接链接当前服务器 `/guide/obsidian#connect`；服务端不支持新端点时提示更新/使用后备，不循环重试 404。

## Agent 分步命令契约

新增 `onboard` 子动作（不恢复废弃顶层 CLI）：

```text
onboard start --server <api-url> --client codex|claude|opencode --protocol json
onboard status --session <uuid> --protocol json
onboard continue --session <uuid> --reply-file <absolute-json-path> --protocol json
onboard continue --session <uuid> --protocol json
```

- start 创建本地 session 并先检查基础环境，返回浏览器授权 URL；每条命令有界返回一个 JSON 对象，不要求后续向进程 stdin 写入。
- status 只读，不推进授权/安装/配置，不输出设备秘密、token 或原始私有配置。
- continue 每次推进到下一次用户决策/授权等待/阶段结果；无 reply 用于轮询授权或继续已确认动作。
- reply 文件承载当前 requestId + values，或 requestId + confirmed + planHash。严格校验、权限限制、一次性消费和过期/错误回复拒绝；shell 字符串中不嵌入任意用户文本或秘密。
- 进度与确认意图落盘、并发 session 锁、故障恢复、配置哈希保护；超时或网络中断不重复创建 Agent/Space，也不能绕过用户确认。旧 session 可继续原流程。
- 新分步授权使用 `purpose:agent-connect`，旧 `full-onboarding` 保持原语义。新 purpose 的 token 在有效期内支持仅凭原 deviceCode 安全重取，避免丢包后永久卡在 authorization_consumed；Obsidian purpose 不可调用 Agent bootstrap。
- `POST /api/onboard/device/renew {deviceCode}` 仅为新 agent-connect 提供重新授权：保留同一服务端 session 和先前已授权 owner，更新 public userCode/期限，要求该 owner 在浏览器重新确认。不能换另一个设备 session 重放先前 bootstrap 并重复创建资源。已完成 bootstrap 的安装包重取也应在原资源/计划/owner 边界内安全恢复，不能依赖只有 600 秒的 Redis replay 缓存永久可用。
- 授权后 `GET /api/onboard/spaces`（OnboardingTokenGuard、仅 full-onboarding/agent-connect purpose）返回 `{spaces:[{id,name}]}`，只列当前用户可用于现有 bootstrap 的空间。Agent 以名称给用户选择并代填 ID；最终 bootstrap 仍实时鉴权。
- 新流程只收集 spaceMode/spaceName 或选中的 spaceId、agentName、role；clientType 在 start 给出；sourcePaths/sourceType/analysisMode 不属于基础连接。
- 确认显示账号授权对象、空间、角色与将修改的客户端配置；只在明确确认后写入。配置重载需求明确输出。
- 完成结果包含 connectionStatus、gatewayVerification、clientReloadRequired、knowledgeImport:'not_started' 等可辨别状态，不能称完成扫描或宿主实际使用。实际宿主工具调用验证仍由外部消费者完成。
- 连接后提示可通过既有 knowledge_* 工具进行导入，仍执行预览与用户确认；不为完成接入而生成伪文档或扫描当前仓库。

## 网页产品体验

- Obsidian 指南首屏为连接行动卡、安装入口、三步说明；手动生成码在首屏后备区域，并有 `id=connect`。旧集成入口仍可直达，不把操作藏在指南长文后。
- 插件主按钮“连接 AgentWiki”，状态“等待浏览器授权/正在连接/已连接/需要重新授权”；已连接后明确下一步选择空间、本地文件夹，不使用“人类凭据”等实现文案。
- Agent 指南按所选客户端复制完整短提示词，驱动 start/status/continue；显示环境准备→浏览器授权→确认空间和权限→配置→实际读取验证。代码和 JSON 细节只在可复制 Agent 提示词或技术详情中。
- 新旧客户端兼容清楚，不能给尚未发布的 npm 版本贴已可用承诺；候选文案、版本钉定与发行同步由集成人统一处理。

## 验收

- 服务端 purpose 隔离、过期、拒绝、账号禁用、重复/并发决定、丢包轮询幂等、速率限制；有真实独立 DB/Redis 集成证据。
- CLI 多次独立进程启动、等待授权、确认、拒绝、错 hash、重复回复、崩溃重启、同 session 并发、已有配置保护；基础接入绝不调用扫描/同步。
- 插件新 Vault 浏览器授权→凭据激活→空间列表→映射；离开设置/重新打开、取消、过期、旧服务器后备；不操作用户日常 Vault。
- 网页中文/英文、登录跳转保留授权上下文、390px、首屏入口、生成码过期刷新。
- 至少一个真实 Agent 客户端从复制提示词到宿主 MCP 调用读取已知测试页；页面渲染、CLI tools/list 和受控 fixture 分别记账，不能替代。
