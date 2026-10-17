# 复测候选验收记录

范围为反馈#1–#8。实现、独立审查、候选真实交互、原环境和发布分别记录；不将测试通过写为线上关闭。基线1fa3bf7e，Web0.12.46。插件独立工作树基线2006701/0.5.11，最终候选15c37be；独立审查已通过，无未解决P1/P2。

## 实现与审查

- MCP：915d58f4修复命名参数注册/legacy wrapper合并；ff6885fb补真实桥接HTTP状态回读。Task3补充复审关闭P2，留非阻断P3：初始化失败listener清理。
- Web：cbee4b19审核新旧接口按createdAt DESC/id DESC全局排序及移除重复返回；18c05eb1补来源内嵌RunsPage返回遗漏。Task2初审、补修复审均无阻断；#3/#4/#5及#6日期使用已修基线。
- 插件：附件超限诊断、恢复上下文与白名单导出初候选已完成；独立审查R1旧push错误归因、R2普通加载错误误标恢复、R3首次push日志校验漏诊断均已修复并复审关闭。

## 原线上只读/不提交交互

- #3 原运行：标题“编写页面”、说明“生成目标页面的完整 Markdown 内容”、待办“编写目标页面”；运行版本1、更新时间保持原值。
- #4 原反馈页编辑点击第12标题，aria-current与视觉定位同一标题；手动滚动解除锚点。未保存。
- #5 启动向导空字段同时行内提示且首错误聚焦；空格/tab/全角空格混合输入被拦截。未创建运行。
- #6 线上10/14单日53条、3页以及10/15单日5条显示日期均正确；仍有状态分组导致时间顺序错误。本地修复未部署，线上问题仍在。
- #8 正确完整legacy wrapper在既有网关可用；原黄金书屋wrapper缺spaceId报错未重现，不能用顶层参数缺陷代替解释。

## 候选真实Web链路

ReviewPage→本地HTTP当前ReviewService→专有隔离PostgreSQL：59条五状态、三页59个唯一ID，全局时间倒序与并列ID倒序；10/14自然日过滤50条两页，起点/终日内末记录包含，前日/翌日起点排除。候选截图[candidate-date.png](candidate-date.png)。这是实际组件/HTTP/服务/数据库链路，未覆盖完整生产shell或窄屏。

来源→展开来源→失败详情进入真实RunsPage，无重复返回；保留顶栏7条链接，来源/设置切换正常。截图[candidate-navigation-runs.png](candidate-navigation-runs.png)。本地fixture入口 `/e2e/fixtures/retest-20261017-navigation.html`；fixture不等同于完整生产shell。

## 插件Mac隔离native

临时Vault加载候选真实Modal、formatter、导出器；旧候选已验弹窗/重试、真实Vault.create导出JSON白名单、导出失败仍保留上下文；sentinel hash未变。仅synthetic隔离native，不连接正式同步身份，不证明Windows原事务恢复成功。补修后又在真实Mac隔离Vault核对普通网络错误仅“重试/关闭”、远端已发布而本地“尚未确认完成”，实际导出白名单JSON，sentinel SHA256仍不变；对应截图obsidian-ordinary-error.png和obsidian-published-recovery.png。最后15c37be仅修首次push校验包装并通过真实hash-corruption runtime回归，不把该机制测试写成原生损坏Vault回放。

## MCP边界

真实SDK/InMemoryTransport→gateway→SpaceMcpBridge/RemoteMcpBridge→本地stateful HTTP：命名参数/完整wrapper透传，更新后独立读取内容与版本；CAS过期、跨Space、无写权限拒绝后状态不变。HTTP fixture模拟published与权限/CAS，不能冒充真实服务端发布。本轮原反馈页使用当前网关完整wrapper实际自动发布，最终ChangeSet cmvbrz6x30cqj11lissy142ra；独立MCP精确回读和Chrome八段渲染通过。该证据不等于候选顶层schema已安装，亦不替代原黄金书屋失败重放。

## 自动验证

主分支pnpm build/typecheck/lint及完整测试exit0。主日志：server3311通过/4跳过，client2659通过，protocol140通过，local-sync1018通过/1跳过；runtime TAP310项/1跳过、另239项/0跳过。不同层级/重跑不相加为唯一总数。Web补修定向70通过；审核定向133通过及隔离DB16通过，专有测试库清理count=0。插件9c66a7e完整check1550通过；最终15c37be局部修复后102定向、tsc/lint/build/bundle通过，独立审查113项通过。主仓最终18c05eb1类型/lint/client build再验通过。

原环境Windows、完整生产shell/窄屏、新MCP顶层schema现网与正式发布部署仍待后续阶段。没有代码push、软件发布、部署或日常插件升级。反馈文档的发布已完成。临时Web/HTTP服务已停止，专有PG库删除后count=0，四个临时fixture已移除，临时Vault窗口关闭，工作树与合成证据保留。


## 用户授权发布后的进度

2026-10-17：Web/API 0.12.47（a192d775）已推送master/tag并正式发布GitHub；插件0.5.12正式发布且完整1551项/三份资产/来源证明通过。主最终full退出0：runtime309通过/1既有skip、串行DB239通过/0skip、server3318通过/4skip、client2659、protocol140、local-sync1018通过/1skip。首次full因外层GIT_WORK_TREE污染临时git init失败；清除该环境变量后完整通过，无产品代码补丁。

npm0.13.1尚待本人安全密钥认证。为避免线上接入指令指向未发布包，生产仍保留0.12.46；新Web生产排序/导航/窄屏、新包SDK顶层真实写回和最终上线回执均pending。配套应用/配置/数据库/附件备份已校验并恢复writers，未演练恢复。原反馈8项发布进度追加published/autoPublished/精确回读/浏览器渲染通过（cmvbwqnjz00bjrinsnvx39hrd）。以release.json为本阶段权威状态，前文为历史候选记录。


## 最终正式发布与生产验收（取代此前认证阻断状态）

2026-10-17 17:19（Asia/Shanghai）npm0.13.1正式发布；官方tarball与固定候选逐字节、171文件匹配，空目录/空缓存registry安装通过。Web/API0.12.47随即部署，1354源码文件匹配a192d775，3服务active，全部5健康字段ok，公网5入口assets同hash；编译review.service.js SHA256 420e511967564c1be603a9de810ef63e6cf08180c6b2591b8f600fb9e8c63a6c与本地一致。63迁移无pending，32烟测通过并清理fixture。新配套备份retest-feedback-v01247.xgdw975j校验通过且writers恢复；旧应用树保留，未做恢复演练。

真实Chrome生产回验：10/14共53条、3页、53唯一ID，已拒绝/已发布/待审核三状态整体倒序且日期正确；10/15共5条日期和倒序通过。原黄金书屋来源展开既有失败→失败运行详情→内嵌Runs→设置，0重复返回且7空间nav；390×809设备视图完成设置/来源/Runs/设置点击切换，document.scrollWidth=390。设备视图中的CDP点击超时后使用真实Chrome原生AX点击完成，未注入页面事件；最终恢复1710宽桌面并关闭DevTools。

正式0.13.1 SDK复用唯一既有连接身份读取原反馈、树revision并使用顶层参数更新。cmvc730wt00albu4scw93k18c published/autoPublished=true；全文精确回读、title/format/folder保持，独立MCP读取及Chrome最终8项呈现通过。正文14359字符，SHA256 42df07a38a7029b18c162f26b2f30db4843230248b753799910d7bd7c3cc48d4。当前Codex配置仍固定0.13.0、未强制重启；正式包验收进程用已校验官方cleaninstall启动并关闭。Windows原Vault仍待验、未升级日常Vault；原黄金书屋wrapper错误仍未复现。最终release.json为权威回执。
