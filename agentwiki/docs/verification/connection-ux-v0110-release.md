# AgentWiki 0.11.0 接入体验正式发布

用户已明确授权发布。候选运行代码16db7cfd，主仓验收记录c6bdf1b3；独立插件5751424。应用0.11.0、Local Sync0.10.0、插件0.5.0，两个仓库的协议依赖分别保持0.6.0和0.5.1。

## 发布前证据

- 已完成候选实现、独立代码复审、必要自动验证和真实客户端成功路径验收，详见connection-ux-candidate-20260909.md。
- Obsidian测试Vault完成浏览器授权、映射、拉取、正文读回及插件重载恢复。
- 用户回传OpenCode实际agentwiki_wiki_get_page调用，标题及验证标记与测试fixture一致。
- 正式发布前重新执行最终主仓全量测试与插件完整check。历史失败证据保留，不把单独重跑成功写为此前完整运行全绿。

## 发布状态

- 主仓master合入和GitHub v0.11.0：准备中。
- npm @neomei/agentwiki-local-sync@0.10.0：准备中。初次身份检查401，用户已恢复登录，npm whoami确认neomei。
- 独立插件main已快进至5751424；正式0.5.0标签与Release等待新服务端API上线后执行。
- 生产部署：准备中。原SSH复用连接过期，用户已恢复登录；1,056个生产源码输入与bbe5c1f5一致，56个成功迁移校验一致（另2条历史rolled-back记录保留），无未解决迁移。239活跃文章词法索引0缺失/0陈旧。未停止生产服务。
- 正式公开安装及线上接入复验：尚未执行。

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
