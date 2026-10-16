# 正式 Obsidian 0.5.11 Windows 原环境回验

2026-10-16 15:00:39–15:07:39 Asia/Shanghai，实际 Windows 远程 Session、Obsidian 1.14.4、原 NeoMei-Docs Vault。结果：**正式升级与两个映射原生只读差异检查通过**。

## 发布身份与安装

正式 [Release 0.5.11](https://github.com/NeoMei/agentwiki-sync/releases/tag/0.5.11)，源码固定 `7e81b9f1163083928033dc311fd14d87e5d3d055`，annotated tag object `94ba5870dbcc6e87753ea7d878e2c7d7dab31889`。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| main.js | 1774928 | 7c12b84aaf82af1ec5d8eeab9edee1f727ed0f5264ef157ec36c2062be3c2926 |
| manifest.json | 233 | 25b54b8a5acb87a80807c5f3931a423ee262b11639ae7897479ed83943417cfa |
| styles.css | 4880 | 5dfe15839220724a57a64ad7ab136761ba2ffaaff3c0235faac1cf1238e762b8 |

Mac发布代理核实CI38863788453成功、下载三资产与clean npm构建逐字节一致，attestation均绑定固定tag/source digest/GitHub-hosted workflow。Windows另从正式Release下载，安装前、安装后和两次只读回验后，三个hash均与上表一致；Windows代理没有冒称自己重做attestation核验。

先校验旧官方0.5.10资产并备份4个插件文件及127个控制文件，131个备份文件逐一核字节/hash，目录访问仅限当前Windows用户与SYSTEM。正常退出Obsidian且进程数为0后只复制三正式资产，保留data.json。旧styles原本相同，实际变化文件只有main.js/manifest.json。

重启后实际runtime：`loaded=true`、`enabled=true`、`version=0.5.11`，Vault与插件绝对目录匹配真实目标；没有新信任或安全提示，没有诊断插桩。

## 原生只读结果

| 映射 | 只读差异 | 权限和策略按钮 |
| --- | --- | --- |
| NeoMei-Space / AgentWiki | Sync v2；本地0；服务器有更新，明细数量未提供；原版本过期错误消失 | 头部“所有者”，缓存role=owner/canPublish=true，三种策略可用，均未点击 |
| 黄金书屋 / 黄金书屋 | Sync v3；本地24项页面差异、目录0；远端0；没有identity/hash错误 | 头部“只读”，缓存role=viewer/canPublish=false，自动合并/使用本地内容禁用；使用服务器内容可用，未点击 |

每个映射只加载一次，无手动重试。权限来自已经加载的plugin runtime缓存只读查询，没有额外HTTP或同步调用。`canRunSyncStrategy`仅在使用服务器内容或canPublish=true时允许该策略，按钮状态符合当前同步身份；不据此推断独立浏览器账号具有相同角色。

24项是本地页面差异，不是冲突计数。UI没有提供冲突数量，保持未知。没有修改授权，也没有执行Pull/Push/合并/覆盖。

## 前后状态与清理

- 两组共113个正文文件（2+111）清单和hash全部不变，24项本地差异保留。
- data.json、映射、全部baseline manifests不变；除tree-identities封装及其.prev外，其余控制文件都不变。
- NeoMei树代次7→8（prev6→7），黄金书屋6→7（prev5→6）；所有payloadHash及序列化payload SHA-256不变。不能将其写成所有控制文件字节不变。
- 临时验收窗口均正常关闭、开发者工具已关闭，无临时验收session运行；真实Vault保留黄金书屋只读差异窗口。
- 两份既有inactive TEMP诊断文件 `diagnostic-once/main.instrumented.js`、`diagnostic-once/validate.cjs` 的删除此前被自动审批拒绝，仅返回 `rejected: blocked by policy`。本轮没有重试或绕过，当前插件不加载它们。

## 原案归因与证据范围

原黄金映射首次从pending/无基线变为active/有基线的操作来源未知，不能把该转换归因为本代理或0.5.11。正式0.5.10的独立机制测试已复现移除/重绑控制基线残留，新修复及退休writer排空通过独立复审、1526测试；Windows57机制测试与临时Vault原生启用/重载另有回执。

本文件证明正式0.5.11真实安装、原生只读加载和数据保持，不冒充真实DataAdapter换根/queued-rename竞态fixture（未执行），也不声称真实生产同步写入通过。

## 私有回执

- Windows最终：`C:\Users\1\AppData\Local\Temp\agentwiki-0510-acceptance-20261016-132543\official-0511-upgrade-20261016\receipt.json`；同目录`backup/`、`before.json`、`closed.json`、`installed.json`、`final.json`。
- 旧0.5.10+Web0.12.45服务端修复回验：上述parent下`neomei-post01245-readonly/receipt.json`。
- Mac主任务回读副本：`/tmp/agentwiki-retest-release-20261016/windows-official-0511-receipt.json`。主代理已核实际命令输出中的最终hash和不变性结果。
- 完整正文清单/配置只在受限私有证据中，未提交仓库。
