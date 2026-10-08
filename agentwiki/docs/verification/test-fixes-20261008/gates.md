# 门禁与证据身份

## 已完成的整仓测试

网页源码 `167237a1d70b36a9dfb05a97438717a01b714201`，2026-10-08 21:13（北京时间）完成 `AGENTWIKI_FULL_TEST=1 pnpm test`，退出码0。

|组|通过|跳过|失败|
|---|---:|---:|---:|
|runtime并行|305|1|0|
|runtime真实数据库|230|0|0|
|后端Jest|3058|4|0|
|前端Vitest|2234|0|0|
|同步协议|140|0|0|
|Local Sync|985|1|0|
|合计|6952|6|0|

跳过项具体为：2项Windows原生执行/ACL；1项需另装CodeGraph并显式启用的标准扫描验收；3项专用连接授权PostgreSQL/Redis门禁（需要专用命名数据库和显式开关）。不能把这些跳过算通过。数据库runtime阶段230项零跳过。

该源码上的整合Chrome 6个spec/15项全部通过，另有真实本地API的目录撤权、Agent绑定持久化和42300字编辑器显式保存/刷新回读。完整typecheck和lint退出码0；lint保留3条既有warning。

随后构建首屏脚本553177字节超550000字节预算，故这次完整测试通过不代表构建通过。最终增量验证如下，不能把较早SHA的测试默认为新SHA重跑。

## 插件最终检查与原生边界

插件最终 `d1d89de8270c2a629886d4b1688375d2d3dc8825` 已重跑 `npm run check`：69文件/1418测试通过，lint/typecheck/build/bundle/release metadata检查通过；19条lint warning既有。最终bundle1747313字节，manifest0.5.6，未发布。

原生Obsidian验收使用 `e5b8a3a`，macOS Sync V2，验证真实按钮手动连接、自动建三级映射目录、首次嵌套树同步、原生编辑器/磁盘逐字回读、再次无差异。`d1d89de`只追加双语错误提示和回归测试；没有再次安装最终bundle到原生fixture，不将两组身份混淆。Windows、V3原生和原测试者UNKNOWN_PARENT仍未验证。

## 独审

六组实现逐项独审与限定修正复审完成，原整分支review及插件M1复审无开放新增问题。新增构建修正d6c3934a已做限定源码复审，无新增findings；原整分支审查继续有效。

## 日志

完整日志保留于本机 `/tmp/agentwiki-1008-final-{test,typecheck,lint,browser,plugin-check}.log`。路径与SHA256见 [gate-results.json](gate-results.json)，独审及产品证据见 [receipts](receipts/)。临时鉴权fixture不属于本验收包，未提交。

## 最后构建增量的最终验证

产品候选 `d6c3934a609590ffbc1cf0e27f7c650ed5113f9c` 仅重定位原文lookup静态加载边界、导出既有tuple并补语言切换E2E。225条映射及双语各229条翻译逐项等价，预算未改。

- 完整client Vitest：141文件/2234项，0失败/0跳过；另有84项定向回归，client typecheck/lint通过。
- root再次运行完整 `pnpm build`，2026-10-08 21:23:06（北京时间）退出码0。首屏542577/550000字节，下降10600；lookup仅进入非首屏RunDashboard chunk。
- 真实生产dist的Chrome首页中英切换、协作中英中切换及1912/1280/390布局、两条旧运行深链/详情/重试/取消/来源切换通过。协作及来源API使用fixture，首页网络无Vite dev脚本且不预载RunDashboard。
- 后端、数据库、协议、本地同步及插件没有因这次映射搬移再次重跑，其文件未变；对应完整回执仍为上文明确的SHA。
- 独立限定源码复审无新增C/I/M；原整分支审查仍有效。
- 此次preview保留NO_COLOR/FORCE_COLOR环境warning；构建保留既有Mermaid circular/large chunk提示，不影响预算门禁通过。
