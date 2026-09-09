# 接入体验候选验收 — 2026-09-09

状态：候选集成进行中，尚未正式发布或部署。用户已批准浏览器授权与可恢复分步接入方案。本记录区分代码、打包、实际宿主与上线证据。

## 用户可见变化

- Obsidian 指南首屏给出「连接 AgentWiki」操作、安装入口与三步说明。默认从插件打开浏览器批准，回插件完成连接；「手动连接码」作为明确后备，说明用途和十分钟有效期。
- Agent 页面按 Codex、Claude Code、OpenCode 复制完整提示词；使用有界 `onboard start/status/continue --protocol json`，每一步落盘，授权等待不再依赖长驻 stdin。
- 基础连接只选择空间、Agent 名称、权限并确认配置；不要求本地目录、不扫描、不上传。配置完成、网关验证、宿主实际读取分开报告。
- 授权过期在原 session 续接，保留 owner；重复兑换不新建资源。旧配置发生冲突时停止，归档不完整时保留旧连接与所有未归档文件。

## 候选范围

主仓基线 `bbe5c1f5`，集成分支 `codex/connection-ux-20260909`。应用0.11.0、Local Sync0.10.0；服务端继续支持0.9.0/0.9.1，Sync Protocol0.6.0不变。插件独立仓基线7f628b5，已固定0.5.0候选c37294ec，仍有生命周期复审问题待修复。无数据库迁移、领域权限或同步协议改动。

当前主运行提交d36d7b4e；网页IPv6 shell引用修复已集成并复审通过，插件生命周期修复仍待集成/审查。精确最终HEAD以本记录后续验收条目为准。

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

- 预览5198/API53098，专用PG55448、Redis56398，两个测试DB使用原56迁移。最后health数据库/Redis/审计持久化/附件存储全部ok。无生产访问或生产修改。
- 中文/英文桌面与390px接入页，实际宽度390、scrollWidth390；语言切换、客户端切换、实际复制提示词、手动生成码及倒计时已操作。截图位于私有证据目录。
- 真实Codex模型分三次独立进程消费网页实际复制的完整提示词，完成浏览器授权、选择「接入验收知识库」、reader权限、确认、bootstrap、安装、网关验证。session4216b0c6-6dad-4fc7-9f40-90a303542a09。知识导入not_started，宿主重载需求明确。
- 因0.10.0未发布，只将提示词固定版本npx入口替换为相同本地候选CLI的测试home包装器。干净安装另行验证；不声称公开npx安装可用。
- 新Codex进程确实发现并调用wiki_get_page，但被隔离进程的MCP审批策略阻止，返回“requires approval, but approval policy is never”。不能算宿主读取通过。已请求用户仅放行本次测试读取，未修改日常配置。
- 新Vault `AgentWiki-Connection-UX-20260909` 已真实从插件按钮打开浏览器授权，exchange/activate后网页设备列表显示已连接。首轮发现Obsidian SecretStorage拒绝带下划线密钥ID，已用native允许的小写/数字/破折号格式修正。旧失败截图保留。
- 插件取消/卸载/换服务器的迟到请求修复及空间映射验收仍待完成。Obsidian前台被另一个项目任务使用，暂未再操作该窗口。

## 独立复审

- Task1：原M1授权代际轮询问题修复，增量C0/I0/M0。
- Task2：配置冲突及归档部分失败两轮修复后C0/I0/M0。复审实际重演0500目录：ARCHIVE_FAILED、安装未执行、旧key/connection/content/config保留；解除故障后同凭据重试成功。
- Task3：6a707bc7修复、c37294ec候选0.5.0的全量check为1345通过/67files，format/typecheck/build/bundle通过，0lint errors/17基线warnings。累计独立复审关闭I1/I4，仍有I2存储await在stop后复活、I3激活时重开触发并发connect破坏旧key，原作者修复中。
- Task4：最终整分支server/web审查C0/I0/M0，IPv6引用修复已独立增量复审关闭；原五项问题另由原审查者补增量。真实zsh probe2项、页面7项、服务端指南1项通过，最终server/client再build通过。浏览器实际复制中文Codex/英文Claude提示词，引用与客户端字段正确，切换语言清除旧复制成功状态。
- 最终CLI/版本累计审查 `bbe5c1f5..6c1ccda3` C0/I0/M0；server/web累计审查亦C0/I0/M0。另由全新独立Codex只读进程审查主分支bbe5c1f5..735c58d8，C0/I1/M0：token过期/code有效/config conflict组合生成过期confirmation，确认和取消都不能进行；已在d36d7b4e修复，独立43项测试与最终增量审查C0/I0/M0；中央相关23项、build及全lint通过。插件最终跨仓审查未完成。

## 证据与下一步

私有证据目录 `/Users/neomei/.codex/recovery/agentwiki-connection-ux-20260909/`（账号与凭据文件0600不写入报告）。主仓SDD `.superpowers/sdd/2026-09-09-connection-ux/` 包含各任务RED/GREEN、独立审查、失败历史与接口契约。

扩展DB首轮HTTP附件用例断言public中没有应用表，本轮server测试库已部署56迁移，与该特定fixture前提不符。新建connection_ux_markdown_test_20260909，预配置public.vector后仅重跑失败文件4/4通过，原共用库不动。新库初次缺vector的预检失败也保留。

LocalSync候选tarball已保存于私有证据release-candidates/neomei-agentwiki-local-sync-0.10.0.tgz，SHA256 9483d4fbfcf38b7bc9f942832c927596b1dfe6f3ae9ed7af261a7c781aa30a4e，源运行提交d36d7b4e（之前tarball保留为pre-expiry-fix）。

剩余：插件最终修复与0.5.0重新打包、相关独立复审、真实MCP读取及Obsidian映射/恢复。之后明确候选交付与三个发行链的发布边界。
