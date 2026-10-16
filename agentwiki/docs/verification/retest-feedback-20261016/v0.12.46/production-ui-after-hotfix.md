# 0.12.46 原案例生产回验

2026-10-16 14:52–14:53 +08:00，真实 Chrome 155 / BrowserSkill 0.3.3。独立验收使用 fresh 公网请求，未修改业务数据。

## #2：通过

0.12.45 上仍英文的同一个人单页运行，0.12.46 的真实响应已返回 `systemTemplateSource.slug=single-page`。界面三处分别显示“编写页面”“生成目标页面的完整 Markdown 内容”“编写目标页面”，用户运行名称和 Agent 名称保持原样。原报告截图对应的另一运行也通过同样对照。

两个运行均保持原有 `running` 状态、version 1 和 updatedAt。未启动、暂停、终止、重试、改派或修改运行。主代理另行目视核对原案例截图，确认三处中文与 Agent 名称。

本次 134 个请求全部为 GET，0 errors / 0 dropped requests，没有 mock、rule 或 replay。capture 已导出并停止，独立验收 session 已停止。私有响应、业务标题、截图与完整 URL 仅保留本地，不提交公开仓库。

## 与前次结果的关系

- 本次关闭的是 0.12.45 暴露的真实历史个人单页来源识别缺口，不以发布成功或 HTTP 200 代替界面验收。
- #12、#13、#17、#19 的生产浏览器回验见 [前次回验](production-ui-before-hotfix.md)。0.12.46 只补服务端来源识别，客户端资产和相关逻辑未改。
- 生产删除关系写入在本轮没有执行；常显入口已原生确认，确认/取消/精确关系 ID 删除由隔离验收覆盖。
- 本轮没有执行真实 Agent 任务，也不宣称覆盖所有模板组合。

## 私有证据索引

- 精确原运行回执：`/tmp/agentwiki-prod-ui-01246-receipt.md`
- 请求与原生操作 capture：`/tmp/agentwiki-prod-ui-01246-private.json`
- 原案例截图：`/tmp/agentwiki-prod-01246-personal-run-chinese.png`
- 原截图运行对照：`/tmp/agentwiki-prod-01246-system-run-chinese.png`

服务端发布身份、源码及编译模块 hash、备份和业务 smoke 独立见 [deployment.json](deployment.json)。
