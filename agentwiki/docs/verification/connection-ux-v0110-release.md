# AgentWiki 0.11.0 接入体验正式发布

用户已明确授权发布。候选运行代码16db7cfd，主仓验收记录c6bdf1b3；独立插件5751424。应用0.11.0、Local Sync0.10.0、插件0.5.0，两个仓库的协议依赖分别保持0.6.0和0.5.1。

## 发布前证据

- 已完成候选实现、独立代码复审、必要自动验证和真实客户端成功路径验收，详见connection-ux-candidate-20260909.md。
- Obsidian测试Vault完成浏览器授权、映射、拉取、正文读回及插件重载恢复。
- 用户回传OpenCode实际agentwiki_wiki_get_page调用，标题及验证标记与测试fixture一致。
- 正式发布前重新执行最终主仓全量测试与插件完整check。历史失败证据保留，不把单独重跑成功写为此前完整运行全绿。

## 发布状态

2026-09-10 正式发布与生产部署完成：

- 主仓master已快进并推送fb632410；[GitHub v0.11.0](https://github.com/NeoMei/AgentWiki/releases/tag/v0.11.0)标签指向fb632410b58865c8320e522dd84c64878a2e07d4。后续仅补充本发布记录。
- [npm @neomei/agentwiki-local-sync@0.10.0](https://www.npmjs.com/package/@neomei/agentwiki-local-sync/v/0.10.0)已公开。用户完成发布2FA，CLI返回202并短暂等待registry处理；随后公开元数据SHA-512与验收tgz一致。隔离缓存全新公开安装成功，159个文件逐一一致。
- 独立插件main及[0.5.0 Release](https://github.com/NeoMei/agentwiki-sync/releases/tag/0.5.0)对应5751424；[发布CI](https://github.com/NeoMei/agentwiki-sync/actions/runs/34382147225)完整check、三资产attestation及发布全部成功。下载官方main.js/manifest.json/styles.css哈希与已验收资产一致，gh attestation verify main.js通过。
- [生产网站](https://agentwiki.quukk.com)已切换0.11.0，API/Worker/Frontend均active、NRestarts=0。公开health五项全部ok；32项API烟测通过。
- 1,423个部署输入/构建文件SHA-256逐项一致；前版542个静态资产逐项保留无漂移（构建阶段补复制296个，其余新旧已有同名内容）。两份env仅LocalSync版本变为0.10.0，其余字节相同。56条成功迁移及2条历史rolled-back记录完全一致，无新增迁移。验收后239活跃页面、239向量，词法索引0缺失/0陈旧。

## 正式包与线上接入复验

- 公开npm安装的CLI、隔离测试profile和生产API实际完成authorization_required → input_required → confirmation_required → configuration_pending:bootstrap → configuration_pending:install → completed。网关27工具，其中21个wiki_*；SDK经stdio调用wiki_get_page返回测试页正确标题和随机验证标记，knowledgeImport保持not_started。此项是正式包/生产API/SDK验证，真实OpenCode宿主验收仍引用前述用户回传输出，不混淆来源。
- 首轮验证脚本错误地要求确认后立即completed，实际收到正常configuration_pending；已修正验收脚本按公开nextAction继续同一会话，无产品代码变更。原失败日志保留，首轮账号已清理；最终账号、Agent、Space均通过正常API删除，保留产品软删除历史。
- Computer Use验证旧标签页切换Agent指南仍可加载；刷新后加载0.10.0新接入指南。OpenCode选择、完整提示词、固定版本start/status/continue与JSON协议均正确；复制按钮显示成功反馈。浏览器工具的clipboard读取为空，未将其记录为已读回剪贴板内容；实际提示词内容通过展开后的DOM核验。
- Obsidian生产指南展示默认浏览器授权、三步说明、手动后备入口及十分钟用途说明，服务器地址为origin。手动入口点击正确跳到#connect。未触发日常Vault或修改日常OpenCode配置。

## 配对恢复位置

- 配对备份：/var/backups/agentwiki/connection-v0110.VRkTfs。
- 前版应用：/root/agentwiki-previous-20260910011607。
- 恢复必须使用配对DB、附件、应用、env和systemd包，不单独启动旧应用。本次未执行回滚。

## 发布顺序与恢复

主仓核验并合入，发布Local Sync固定版本，再使用配对DB、附件、应用、systemd备份部署服务端和网页；保留旧静态资源与前版应用目录。生产确认后发布独立插件0.5.0，最后核验公开包、官方资产及线上接入。

本轮无新增迁移；保留56个既有迁移的完整校验。两份生产env只允许LOCAL_SYNC_PACKAGE_VERSION从0.9.1变为0.10.0，其余字节与秘密保持。发布不自动改写日常Vault或用户OpenCode配置。

私有证据与运维工具位于/Users/neomei/.codex/recovery/agentwiki-connection-ux-20260909/；凭据不进入Git或日志。

本轮运维工具release-ops从已审查v0.10.2工具窄改。14项契约、2项真实临时PG16恢复测试与全部语法检查通过；独立审查C0/I0/M0，另实测SSH带空格socket参数和维护失败仅stop不restart。六个上传helper哈希一致，生产恢复前置检查通过。生产恢复未执行。

## 发布前最终自动验证

| 范围 | 最终结果 |
| --- | --- |
| runtime非DB | 263通过、1个需显式开启的CodeGraph门禁跳过 |
| runtime真实DB | 207通过、零跳过 |
| server完整 | 151 suites、2605通过、1 Windows原生跳过；包含新增3项接入DB测试 |
| client完整串行 | 104 files、1449通过 |
| protocol完整 | 140通过 |
| Local Sync完整串行 | 65 files、924通过、1 Windows ACL跳过 |
| 独立插件完整check | 67 files、1353通过；format/typecheck/build/bundle通过，lint0error/17基线warning |
| 主仓typecheck / lint / build | 全部通过；构建保留既有Mermaid循环chunk及体积提示 |

主仓合计5588项通过，3项跳过的具体边界如表。证据由下述完整阶段复验组成，不声称第一次test:full单次全绿。

首轮test:full的runtime阶段全部通过；server发生4个默认5秒runner超时，另一个ENOENT是前一个超时用例尚未结束的Promise遇到afterEach删除目录。两个文件及对应产品代码相对bbe5c1f5无差异；原样、默认5秒单跑109/109通过，耗时由失败轮约74秒降至27.744秒。现场系统load为37.40/43.92/34.02。独立审查确认5秒是测试预算，不是产品性能门限，50ms锁等待和100/500数量断言保持不变；随后用同一随机schema隔离与20秒Jest预算完整server复验通过。

client默认并行首轮5项等待/超时失败，1444项通过；相同源码和断言改为单worker完整复验1449/1449通过。Local Sync亦单worker运行，未放宽既有20秒预算。原始失败日志保留；没有修改产品实现、测试源码或删减断言来获得通过。独立分析见SDD/release-test-timeout-analysis.md。
