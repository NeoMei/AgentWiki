# 接入体验候选验收 — 2026-09-09

> 后续正式发布已于2026-09-10完成，见[0.11.0发布记录](connection-ux-v0110-release.md)。下文保留候选验收时点与历史失败证据。

状态：候选实现、自动验证与独立代码审查已完成；Obsidian真实成功路径通过，用户已回传OpenCode实际单页读取成功结果，Agent宿主读取门禁通过。OpenCode反馈引出的网关诊断缺口已修复并复审关闭。尚未正式发布或部署。本记录区分代码、打包、实际宿主与上线证据。

## 用户可见变化

- Obsidian 指南首屏给出「连接 AgentWiki」操作、安装入口与三步说明。默认从插件打开浏览器批准，回插件完成连接；「手动连接码」作为明确后备，说明用途和十分钟有效期。
- Agent 页面按 Codex、Claude Code、OpenCode 复制完整提示词；使用有界 `onboard start/status/continue --protocol json`，每一步落盘，授权等待不再依赖长驻 stdin。
- 基础连接只选择空间、Agent 名称、权限并确认配置；不要求本地目录、不扫描、不上传。配置完成、网关验证、宿主实际读取分开报告。
- 授权过期在原 session 续接，保留 owner；重复兑换不新建资源。旧配置发生冲突时停止，归档不完整时保留旧连接与所有未归档文件。

## 候选范围

主仓基线 `bbe5c1f5`，集成分支 `codex/connection-ux-20260909`。应用0.11.0、Local Sync0.10.0；服务端继续支持0.9.0/0.9.1，Sync Protocol0.6.0不变。插件独立仓基线7f628b5，最终0.5.0候选5751424，依赖协议仍0.5.1。无数据库迁移、领域权限或同步协议改动。

当前主运行提交16db7cfd；网页IPv6 shell引用修复、插件生命周期修复、网关实时诊断及工具集合重载提示均已完成并独立复审关闭。

## 自动验证

| 门禁 | 结果与范围 |
| --- | --- |
| 主仓 build | shared/protocol/server/client通过；Local Sync初轮因新增测试0.9.1 literal失败，改为候选0.10.0后单独build通过；失败记录保留 |
| 全类型检查 | 修复归档及lint后再次通过 |
| 全lint | 初次2错误：caught error缺cause、测试空catch；修正后通过，对应9项回归通过；归档二次修复新增缺cause再修正，最终全lint及13项归档回归通过 |
| 客户端完整测试 | 103files /1447通过 |
| 服务端完整测试 | 150suites /2602通过，4跳过；由独立测试DB中随机schema执行 |
| 接入真实DB/Redis | 专用3/3通过；对应全server里未启用的3项opt-in gate另行运行 |
| Local Sync完整测试 | 65files /907通过 /1原有跳过，单worker；实际fs冲突、归档和重试覆盖 |
| 干净安装 | 新临时目录和npm cache，安装本地0.10.0 tarball，依赖公开registry的protocol0.6.0；版本、依赖、CLI启动全部通过 |
| 运行版本契约 | 33/33通过，包含build与pack |
| 扩展runtime | parallel263通过/1原生平台跳过；DB207项中206通过，1因测试库public非空失败。该文件换独立空库后4/4通过，失败关闭；不是单次完整全绿，原失败记录保留 |

server首次完整测试在 `PG_DUMP_BIN` 必填预检停止，配置本机PostgreSQL16 pg_dump后重跑通过；未放宽数据库安全检查。

## 真实浏览器与宿主

- 首轮验收使用预览5198/API53098，专用PG55448、Redis56398，两个测试DB使用原56迁移。最后health数据库/Redis/审计持久化/附件存储全部ok。该阶段无生产访问或生产修改；后来OpenCode旧连接诊断仅做生产MCP工具发现，见文末记录。
- 中文/英文桌面与390px接入页，实际宽度390、scrollWidth390；语言切换、客户端切换、实际复制提示词、手动生成码及倒计时已操作。截图位于私有证据目录。
- 真实Codex模型分三次独立进程消费网页实际复制的完整提示词，完成浏览器授权、选择「接入验收知识库」、reader权限、确认、bootstrap、安装、网关验证。session4216b0c6-6dad-4fc7-9f40-90a303542a09。知识导入not_started，宿主重载需求明确。
- 因0.10.0未发布，只将提示词固定版本npx入口替换为相同本地候选CLI的测试home包装器。干净安装另行验证；不声称公开npx安装可用。
- 新Codex进程确实发现并调用wiki_get_page，但被隔离进程的MCP审批策略阻止，返回“requires approval, but approval policy is never”。不能算宿主读取通过。已请求用户仅放行本次测试读取，未修改日常配置。
- 新Vault `AgentWiki-Connection-UX-20260909` 已真实从插件按钮打开浏览器授权，exchange/activate后网页设备列表显示已连接。首轮发现Obsidian SecretStorage拒绝带下划线密钥ID，已用native允许的小写/数字/破折号格式修正。旧失败截图保留。
- 插件取消/卸载/换服务器的迟到请求代码修复及自动回归已完成。首轮因Obsidian前台被另一任务使用而暂缓的空间映射/重载恢复验收，已在下文Computer Use阶段完成。

## 独立复审

- Task1：原M1授权代际轮询问题修复，增量C0/I0/M0。
- Task2：配置冲突及归档部分失败两轮修复后C0/I0/M0。复审实际重演0500目录：ARCHIVE_FAILED、安装未执行、旧key/connection/content/config保留；解除故障后同凭据重试成功。
- Task3：原I1–I4及修复引入的终态恢复回归全部关闭，最终5751424累计C0/I0/M1，M1仅17条基线lint warning。前一提交6a7b142完整check1350通过/67files；最后增量65项、format/typecheck/lint/build/bundle通过；控制器独立65项及bundle/metadata通过，不冒称1350在最后HEAD重跑。
- Task4：最终整分支server/web审查C0/I0/M0，IPv6引用修复已独立增量复审关闭；原五项问题另由原审查者补增量。真实zsh probe2项、页面7项、服务端指南1项通过，最终server/client再build通过。浏览器实际复制中文Codex/英文Claude提示词，引用与客户端字段正确，切换语言清除旧复制成功状态。
- 最终CLI/版本累计审查 `bbe5c1f5..6c1ccda3` C0/I0/M0；server/web累计审查亦C0/I0/M0。另由全新独立Codex只读进程审查主分支bbe5c1f5..735c58d8，发现token过期/code有效/config conflict组合生成过期confirmation；已在d36d7b4e修复，独立43项测试与最终增量审查C0/I0/M0；中央相关23项、build及全lint通过。插件最终累计跨仓审查亦已完成，无Critical/Important遗留。

## 证据与下一步

私有证据目录 `/Users/neomei/.codex/recovery/agentwiki-connection-ux-20260909/`（账号与凭据文件0600不写入报告）。主仓SDD `.superpowers/sdd/2026-09-09-connection-ux/` 包含各任务RED/GREEN、独立审查、失败历史与接口契约。

扩展DB首轮HTTP附件用例断言public中没有应用表，本轮server测试库已部署56迁移，与该特定fixture前提不符。新建connection_ux_markdown_test_20260909，预配置public.vector后仅重跑失败文件4/4通过，原共用库不动。新库初次缺vector的预检失败也保留。

LocalSync候选tarball已保存于私有证据release-candidates/neomei-agentwiki-local-sync-0.10.0.tgz，SHA256 9483d4fbfcf38b7bc9f942832c927596b1dfe6f3ae9ed7af261a7c781aa30a4e，源运行提交d36d7b4e（之前tarball保留为pre-expiry-fix）。

插件最终产物已归档在私有证据release-candidates/agentwiki-sync-0.5.0-5751424/，main.js SHA256 02f62415af0d0c054355d17714a7d6a3e25633a3e476cae6857e988bab859d1b；manifest/styles哈希见同目录sha256.json。最终bundle已安装到本轮专用Vault并完成下文验收。

## Computer Use 实际验收补充

用户要求通过 Computer Use 完成真实客户端验证后，已通过 Obsidian 的 Window 菜单选择本轮专用 Vault，未操作日常 Vault 内容。专用 API/前端重新启动，health 五项正常。

- 停用旧测试插件，保留旧三件套备份，将最终5751424产物复制到测试Vault。界面刷新显示v0.5.0，重新启用后原连接自动恢复。
- 实际空间下拉显示「接入验收知识库（所有者）」，添加到ConnectionAcceptance；新路径需先创建文件夹，映射状态提示清楚显示该要求。通过文件列表新建文件夹。
- 同步面板实际预览创建pages/连接验证说明.md，确认后拉取。通过快速切换打开该笔记，正文实际显示CONNECTION-UX-20260909-READ-OK。
- 设置重开显示ConnectionAcceptance已激活；再通过第三方插件开关停用/启用，确认原连接与映射仍已激活。截图obsidian-final-page-read.png、obsidian-final-reloaded-mapping.png；computer-use-acceptance-result.json记录产物hash与结果。
- Agent交互验收脚本已准备，仅暴露测试服务的wiki_get_page，保留on-request审批和read-only。Computer Use分别拒绝访问com.apple.Terminal和com.openai.codex，均返回“for safety reasons”，故无法代操作交互审批。未改用其他终端绕过限制、未降低审批要求。脚本尚未启动。

Obsidian成功路径、映射、拉取、实际正文及插件重新加载恢复已验收通过。尚未发布或部署。

## OpenCode 真实反馈与定位

用户手工在Warp中的OpenCode执行测试页只读任务，报告仅六个local工具。只读现场检查确认：

- 实际配置为npx @neomei/agentwiki-local-sync@latest gateway，运行版本为0.9.1；连接340ed189-91ec-59a4-af9f-fda468e3748b指向生产https://agentwiki.quukk.com/api，未使用候选测试连接。
- 使用这条现有连接只做MCP工具发现，生产返回HTTP401 / UNAUTHENTICATED；当前凭据不被接受，未调用生产页面工具、未写生产数据。RemoteMcpBridge.listTools吞掉远程发现错误并返回空集合，六个local工具仍能加载。不存在需要手动开启wiki_*的开关。
- 候选测试连接4216b0c6-6dad-4fc7-9f40-90a303542a09通过真实SDK stdio发现27个工具（21远程），实际wiki_get_page返回正确标题与验证标记。证据agent-consumer/opencode-preflight-read.json；SDK探针不代表OpenCode宿主验收通过。
- Computer Use访问Warp亦明确被拒绝（for safety reasons），没有换技术绕过。准备agent-consumer/start-opencode-acceptance.py供用户在Warp新标签页启动；使用临时OPENCODE_CONFIG_CONTENT覆盖MCP连接，不改全局文件，只允许wiki_get_page弹出单次审批。已用OpenCode debug config验证最终配置及权限合并。
- 网关诊断已在101a4ef9补齐，16db7cfd修复工具集合等量变化时漏报重载。保留onboard_status原历史字段，新增onboardingStateMeaning与当前gateway诊断；401提示重新授权、403检查权限、503等故障建议重试，真实30秒总发现超时。本地工具离线仍可用，诊断不包含原始错误正文或凭据。
- 作者35项、中央gateway目录66项及build通过。独立28项及deadline/cleanup实测通过；唯一M1已修复，作者新增5种集合变化回归，中央与独立各18项通过；最终C0/I0/M0。中央完整LocalSync回归首轮因直接调用vitest漏带项目20秒参数，14个文件恢复测试按默认5秒超时；保留证据后使用项目test脚本重跑：923通过/1跳过/1源码锁测试20秒超时。该源码与测试相对bbe5c1f5未改，原样单文件重跑29项在2.08秒内通过，超时未复现；不声称单次完整全绿。
- 真实探针验证旧生产连接报告REMOTE_AUTH_REQUIRED。复测发现本地验收服务已停止，新诊断报告REMOTE_UNAVAILABLE；恢复专用服务后health五项ok、前端200、SDK stdio实际27工具/21远程、当前connected且读回正确标题与标记。分别保留gateway-diagnostic-service-stopped.json与gateway-diagnostic-read.json；不将SDK探针记为OpenCode宿主验收。
- 最终候选包位于release-candidates/gateway-diagnostics-16db7cfd/neomei-agentwiki-local-sync-0.10.0.tgz，SHA256 f8f7bd1e8d91174695cc8507640e31acfefaffcd2988e7596ec625ddc7b4ae50；旧候选包保留。真实OpenCode宿主结果仍待回传，尚未发布或部署。
- 用户继续后核对集成树aabe5852与最终代码16db7cfd，工作树干净、独立复审已关闭。再次通过最终构建的SDK stdio实际读取：27工具/21远程、REMOTE_CONNECTED、标题与标记正确；前端与API health均200。证据agent-consumer/gateway-diagnostic-final-read.json。此记录仍不替代OpenCode宿主读取。

## OpenCode 宿主读取验收关闭

用户在当前任务回传真实OpenCode执行记录，包含工具调用事件和实际结果：

- 工具：agentwiki_wiki_get_page（MCP）。
- 请求：spaceId cmttuwgxp001h65p8qeft2qtm；pageId 1b0a8e76-ae2d-4756-a2dc-944aafb35eb6；只读单页，不使用knowledge_pull。
- 返回标题：连接验证说明。
- 返回正文验证标记：CONNECTION-UX-20260909-READ-OK。

两个返回值与测试fixture一致，Agent宿主实际读取门禁通过。证据来源明确为用户粘贴的客户端工具调用与结果；不是控制器直接操作Warp或另一次SDK探针。结构化记录保存在私有验收agent-consumer/opencode-user-reported-read.json。先前Codex审批失败、OpenCode旧生产连接401均保留为历史失败，不改记成功。

至此，两条已选客户端成功路径的本地候选验收均完成。公开npm版本、master合入、生产部署、旧生产连接重新授权仍未执行，不能由候选验收推导正式环境已可用。
