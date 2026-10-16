# 复测反馈第二轮修复候选

报告： https://agentwiki.quukk.com/pages/4088516b-4f90-4803-aeb2-7ddc63a86c32 ，读取版本 2026-10-16T10:54:37.034Z。原报告其余14项保持用户“复测已修复”的结论。

Web五项与 Windows 差异加载所暴露的服务端历史链兼容修复均已通过独立审查，最终整仓 7644 通过 / 6 既有跳过 / 0 失败，typecheck、lint、build 通过。正在执行 0.12.45 配套备份与生产发布；实际部署结果以 deployment.json 为准。Obsidian 原案和插件新修复独立验收，不交付旧已撤回候选。

## 2026-10-16 发布阶段更新

Windows 官方 0.5.10 的一次受限诊断已实录首条失败为 v2/head 的 HTTP 410 / REVISION_GONE。生产只读核查发现：保留历史以 legacy 版本段开头，其后是正常首次内容树 v2；旧的严格入口仍强求已经物理清理的完整 legacy 历史，因而误拒可信链。补丁 65e91103 加入最窄的普通首次 v2 边界识别，保留精确同 Space 前驱、连续历史与完整快照/hash/delta 校验；02157186 完善真实 DB 测试清理。没有修改生产历史、基线或凭据。独立固定 HEAD 审查见 [server-chain-review.md](server-chain-review.md)。

最终候选只读诊断进程已成功校验并返回原生产 head；这只是候选对真实数据的验证，尚不能替代部署后 Windows 插件回验。整仓最终门禁 7644/6/0，含 server3301/4、DB239/0，详见 validation.json；版本准备后的 typecheck/lint/build 再次全部通过。历史保留服务仍会保守拒绝该类普通 cutover 的清理，本次没有改变 retention，不宣称这部分已兼容。

用户确认黄金书屋就在当前远程 Windows。已在原 Vault 找到其映射，最新官方 0.5.10 原生只读差异加载成功，显示本地24项、远端0项，未出现原身份错误；正文与基线保持不变，未执行 Pull/Push/覆盖。另一个映射的 410 问题等待本次服务端部署后回验。正式插件基线上的新映射/后台写入修复仍独立推进，不能用这些结果宣称插件新候选已发布。

以下保留上一阶段记录，遇到状态冲突以上述最新结果和后续生产回执为准。

## 2026-10-16 后续：以最新正式插件为准

用户随后指出 Obsidian bug 已修复并要求查看最新插件。已实时核实正式 Release **0.5.10 / 2df7cfa**（https://github.com/NeoMei/agentwiki-sync/releases/tag/0.5.10），包含远端目录归档及旧任务恢复修复；另一聊天已完成 Mac 原生 Wiki 零差异验收与正式发布。本机安装0.5.10，main.js与官方文件仅相差Obsidian附加的 `/* nosourcemap */` 标记，代码内容一致。

本聊天旧0.5.9 mapping-detach候选不再交付/安装。合并候选845920be的独立组合审查发现并发P2（差异刷新重建已归档控制目录）；该问题未修复，禁止发布此旧候选，不归因到不含该实现的正式0.5.10。之前的单任务PASS和1506自动化通过不覆盖该并发发现。

用户已授权通过现有Windows远程Session验收。Windows原0.5.8现已备份并升级正式0.5.10；三个官方资产哈希、旧进程退出、重新启动后的插件管理器启用版本均核实。原生同步中心仍报“加载差异失败：远端版本已过期。请先拉取最新版本。”尚未定位黄金书屋原Vault，也未捕获首条失败endpoint，因此不能把该错误当作原基线身份错误或认定具体根因。连接设置、两份正文和原有控制文件未变；仅正常扫描新增两个空tree-identities文件。未执行Pull/Push、内容覆盖或删除映射。详见[正式插件Windows验收](official-plugin-windows.md)。

旧候选没有装到Windows。Web五项代码修复与原门禁结论不变，仍未发布部署。

## 六项处理（前一阶段记录）

| 报告项 | 原因与处理 | 已有证据 / 边界 |
| --- | --- | --- |
| #1 Obsidian 基线损坏 | 前一阶段曾实现重映射归档候选，现已撤回，不再交付。用户指出插件已修，改验正式0.5.10。 | 正式版归档恢复有Mac原生验收；Windows正式版加载差异仍失败且错误不同，原黄金书屋基线错误未取得同环境回验。旧候选自动化通过不代表可发布。 |
| #2 个人单页仍英文 | 普通单页默认workflow已有英文存储文字，但个人/Space模板缺显示来源标记；根据运行冻结定义识别默认流程（包括合法null），前端显示中文。 | 个人/Space×running/completed合法schema回归；显式自定义flow、Agent名字保留。初版null遗漏已独立发现、补修复审。 |
| #12 编辑目录高亮上一条 | 滚动margin和监听坐标不一致；虚拟化让前面标题不可测。统一可见边界、采用CodeMirror高度映射，点击后随布局稳定并在实际滚动时释放。 | 原报告全文本地哈希一致回放，点击#12正文与高亮一致；合成长短文、重复/折叠/文末、1440/390px 4项E2E通过。 |
| #13 删除关系难找 | 按钮藏于折叠证据内且只有小图标；改为每条关系常显中英文文字按钮，保留确认、权限及真正relation ID。 | Chrome确认删除合成关系4→3、38个页面不变；中英390px无横溢；失败保留上下文。 |
| #17 其余必填toast/空格误过 | 客户端校验未统一、字符串只验长度；统一全部必填行内错误/首错聚焦，前后端拒绝纯空白。 | 全空、视觉顺序聚焦、数字key、0/false、可选输入及中英文验证通过。 |
| #19 日期漏今天/混入后一天 | PostgreSQL将timestamptz参数与UTC值timestamp列隐式按session时区比较，发生偏移；只转换参数为UTC timestamp，保留半开区间。 | 真实PG跨session时区/DST/毫秒边界；真实UI→ReviewService→PG单日只返回当天0点/中午/最后1ms，次日0点和3点被排除。 |

## 候选与审查

- Web基线 `35f73159`（v0.12.44）；产品与回归最终提交 `07d6abc976efdadf9b755793e5682bcf982a7df3`。分支 `codex/retest-feedback-20261016`，工作树 `/Users/neomei/.codex/worktrees/retest-feedback-20261016/AgentWiki `（尾空格）。
- Web四组任务独立审查及fresh整分支审查PASS，无未关闭阻断项；见 [final-web-review.md](final-web-review.md) 与各 task review。
- 已撤回的Obsidian源码 `85b4078`、后续组合 `845920be` 只作历史记录；组合审查发现未修复P2，撤回记录提交 `e3b1450`。隔离工作树 `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/.worktrees/retest-baseline-20261016`。
- 该工作树中旧0.5.9候选包均停止使用，不安装、不合并、不发布。当前有效插件为官方0.5.10。

## 验证与原案边界

- Web typecheck、lint、build均exit0；初始JS 548270/550000字节。
- 最终 Web `pnpm test:full`：exit 0，7624 passed / 6 既有 skipped / 0 failed（runtime309/1skip、真实数据库239、server3281/4skip、client2657、protocol140、local-sync998/1skip）。日志 `/tmp/agentwiki-retest-full-tests-final.log`。
- 旧Obsidian候选历史检查：71 files / 1478 tests、独立聚焦37通过；整合后1506通过，但fresh组合审查新增并发复现失败，因此撤回。不能引用旧PASS作为正式0.5.10或旧组合的交付结论。
- 第一轮全仓仅图谱两个用例过早操作派生节点失败；基线复现其中拖动竞争。两处改等真实节点，保留原断言，修后client2657及图谱43通过；最终整支再跑完整harness，不掩盖初次失败。
- 浏览器过程与证据边界见 [browser-acceptance.md](browser-acceptance.md)，合成截图 task-1-browser-390.png / task-3-browser-390.png / task-4-browser.png。
- 本地浏览器、Vite、日期HTTP bridge已关闭；日期独立数据库已删除并回读0。全仓harness管理自己的临时数据库和Redis。
- 原报告全文、原站debug与原案截图只保留 `/tmp` 私有副本，不提交公开仓库；未改生产页面。Windows仅升级官方插件资产并运行只读差异检查，正文与连接未变，控制文件增量详见正式插件验收。

## 后续集成

用户要求继续修复后，已集成远端 `5c9d52cf` 的 v0.12.44 生产回执文档，产品代码未变，准备 Web/API 0.12.45；build/typecheck再次通过。SSH恢复后只读核对生产1345个源码文件均匹配v0.12.44，63个迁移已应用、健康与三个服务正常。尚未推送、发布、备份或部署，待独立发布审查后推进；详见[发布准备](release-preparation.md)。插件0.5.10已由另一聊天正式发布，本轮不再整合旧候选。Windows新错误保留待诊断，后续以首个失败请求及原Vault证据定因，不删除基线绕过。
