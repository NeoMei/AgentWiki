# 正式插件 0.5.10 核对与 Windows 原生验收

## 结论

根据用户“Obsidian 的 bug 已经修了，看看最新的插件”的最新指示，以正式 **0.5.10 / 2df7cfa** 为准。本聊天旧mapping-detach候选已撤回，没有安装到Windows。

- 官方发布及Mac归档恢复验收：已核实。
- Windows官方资产安装、启用与重新加载：通过。
- Windows既有映射只读差异加载：未通过，仍显示“加载差异失败：远端版本已过期。请先拉取最新版本。”
- 首条失败endpoint、HTTP状态、响应code及调用栈：未取得，根因未确定。
- 原报告黄金书屋Vault：未定位；本次错误不能替代原“指针身份/哈希不匹配”的原环境复测。

## 正式发布证据

[官方Release](https://github.com/NeoMei/agentwiki-sync/releases/tag/0.5.10)发布于2026-10-16T05:19:09Z，非draft/prerelease。本机主仓源码HEAD为2df7cfa。

修复内容为父目录归档避免重复提交后代、待恢复任务显示真实操作数、确认未发布时取消旧任务并重新预览、已发布继续收尾、不明状态保留，以及阻止过期归档任务自动重建发布。

发布聊天与仓库发布说明记录1469自动化测试、独立审查、Mac原生取消旧任务、恢复1目录/10页面、逐页云端哈希一致及零差异验收；另一映射94文件保持。Mac安装bundle与官方包仅差Obsidian附加的18字节`\n\n/* nosourcemap */`，代码内容一致。

| 官方资产 | SHA-256 |
| --- | --- |
| main.js，1763964字节 | fc3bf654521727688c9b86b1defdd0fe258dc1755ba5cd30768136caaa85252d |
| manifest.json | e1e3e2ce6cf5cde6a6f95de02ce97f90ec9888063add3f75906128cdf954029b |
| styles.css | 5dfe15839220724a57a64ad7ab136761ba2ffaaff3c0235faac1cf1238e762b8 |

## Windows 实际执行

通过用户指定的现有远程Session执行。运行时Obsidian为1.14.4，原插件0.5.8。先备份插件4文件与原控制目录15文件，并记录2份映射正文的路径、字节数与哈希；备份目录ACL仅当前用户和SYSTEM。随后正常退出Obsidian，确认进程已结束，下载并校验官方三资产，仅替换main.js、manifest.json、styles.css，再启动原Vault。

插件管理器实际显示并启用v0.5.10，三资产安装哈希一致。同步中心仍显示上述错误；进行了唯一一次诊断用只读重新加载，结果相同。

最终数据对比：data.json、2份正文、原有基线与事务控制文件均未变。扫描新增tree-identities.json及其.prev，其中folders、pendingFolders、pendingPages均为空。未执行Pull/Push、覆盖、取消旧任务、删除映射、重绑或改授权。

远程受限本机回执：`C:/Users/1/AppData/Local/Temp/agentwiki-0510-acceptance-20261016-132543/receipt.json`。原生错误与启用版本截图保留在远程聊天工具记录；凭据、完整Vault清单和正文未复制到此仓库。

## 诊断边界

官方适配器使用Obsidian `requestUrl`，可访问的DevTools Network列表没有捕获对应请求。没有安全可复用的运行时客户端调用通道，未直接调用v2/head或v3/head，也未持久修改产品代码或启用调试端口。

中文文案对应源码对REVISION_GONE的映射，但这不是HTTP响应实录。普通旧delta过期已在remoteDelta捕获并降级；head、snapshot、已发布Push恢复收尾等仍需首条失败请求才能区分。插件会根据v3空间列表的syncMode选择legacy_v2或bootstrap路径，不能凭历史v3/head返回410推定当前协议探测错误。

独立只读源码审计还确认：`/v3/spaces`会校验整个可访问空间列表，其他空间的不可用或完整性校验失败revision也可能让列表整体失败；当前错误未必来自映射空间。证据为插件`main.ts:845-873,1199-1227`、`sync-runtime.ts:1463-1494`及服务端`sync-v3-revision.service.ts:169-178,194-206,407-420,480-497`。当前没有证据支持修改协议回退或再次发布插件。

后续最小证据为首个失败请求的脱敏路径、HTTP状态、error.code及调用来源。不得为消除报错直接重置基线或删除映射，也不能据版本升级成功宣称同步成功。
