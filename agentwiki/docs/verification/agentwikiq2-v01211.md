# AgentwikiQ 2 修复与发布验收

2026-10-02复核：应用0.12.11已部署，Local Sync0.10.2/protocol0.6.1正式公开。20项及2条附加接入问题的修复代码均已实施和独立审查；主路径及本次补充边界验收通过。

权威原报告：主工作区 测试报告/AgentwikiQ 2/问题清单-缺陷详情09-29.md、agentwiki-onboard-diagnosis.md。基线1335765cd；部署执行代码5638dd8dc2fa961f29e436d095da23ad983846cb。

|项|范围|实现与部署后的证据|
|---|---|---|
|1|移除新Git来源|Task4独立审查；真实来源选择/提交通过|
|2|协作中文|Task3独立审查；真实系统协作Todo中文通过|
|3|Toast自动消失|真实Chrome同Agent风险Toast自动隐藏通过|
|4|中文错误|真实移除成员后的中文403及无编辑按钮通过|
|5|角色中文|真实成员页读者/编辑者/发布者通过|
|6|公网TLS|实际终止点补齐证书链；默认Node信任及五项health全部ok|
|7|Obsidian目录/同步|正式0.5.6资产新生产公网20项通过；Obsidian 1.13.7 原生 GUI 隔离 Vault 已实测连接、嵌套映射、Pull、编辑、Push、服务端回读及重载持久性；该 Vault 使用 Sync v2，原生 GUI 的 v3 分支仍由独立 HTTP v3 门禁覆盖|
|8|协作管理导航|真实Chrome跳转/管理tab与去除无关入口通过|
|9|审核加载/刷新|真实ingest后已打开review页加载/刷新通过|
|10|独立页面/目录绑定|Task2独立审查、本地feature-off/DB覆盖；公网独立绑定API/UI通过，生产开关开启|
|11|人工审核文案|真实MCP提交→pending→Chrome通过→人工审核/已通过中文文案通过|
|12|重新进入继续指令|running重入、审核后继续、paused真实恢复、waiting_review独立继续读取均通过；不改变version/status/eventSequence|
|13|协作布局|真实桌面/390px几何、独立滚动与无横向溢出通过|
|14|图谱标签|真实22长中英标题，缩放/边界/无重叠/完整选择通过|
|15|来源运行结果|真实运行结果/产物/审核链通过|
|16|非成员平台管理员只读|自建human严格提权，9类写入403和Chrome只读，真实降权及JWT401清理通过；附件/review写拒绝也覆盖|
|17|图片放大|真实PNG上传、页面/编辑预览、Enter/Escape/焦点及比例通过；外部 HTTPS 图片实际加载、放大/关闭及桌面/390px复验通过|
|18|看板子任务对齐|真实Markdown晚父单子、深度与移动滚动通过；多子任务溢出桌面/390px几何复验通过|
|19|实现阶段同步|真实UI状态写入，implementation同步且validation/acceptance独立保持通过|
|20|待验收紫点|真实计算颜色rgb(133,100,196)通过|
|附1|一次性码publisher|正式包真实code NDJSON安装/MCP读页通过；原始计划16scopes/篡改拒绝|
|附2|device publisher|正式包真实device JSON授权安装/MCP读页通过；凭据/JWT401与临时文件清理|

最终验证：逐任务及整分支独立审查、Linux导入与DB夹具增量审查全部Approved，0 Critical / 0 Important。完整pnpm test:full exit0：runtime263、DB216、server2754、client1630、protocol140、local-sync925，共5928 pass / 0 fail / 6既有或平台skip。DB零skip。类型/lint/build通过，lint3条既有unused参数warning；初始JS546154/550000B未提高预算。

公开Local Sync0.10.2 SHA1：4723623a626c674fa8051c465bf805c95e943393，与候选一致；Linux空目录官方registry安装96包、CLIhelp/gatewayimport通过。公开0.10.1存在case-sensitive SDK导入错误，0.10.2已修复。protocol0.6.1不变。

生产部署2026-10-01 18:25 CST：1421源码文件清单核验5638dd8d一致，API/worker/frontend三服务active，公网默认TLS健康五项ok。数据库/附件配对备份 /var/backups/agentwiki/q2-v01211-20261001182522，dump SHA256 94747403318aadd04fef40282d8ba51f41b29963af63d2b25cc5403cc011e8de；manifest SHA256 e086baf58f6529efa865a5514eb46c07ecdd56a0ad51f139ae97934ad788a43f。60个迁移文件字节一致，无迁移执行；三份Assist修复保留，旧应用与1848客户端资产保留。

公网证据：Chrome18项主路径结果分首轮/恢复/独立补验取得，最终全部PASS且cleaned=true；最初选择器与页面加载竞态导致的harness失败保留，未据此更改产品。正式插件0.5.6 SHA256 5b7b307039dac8dc6613f942f5f5d8387f3164c0456b4940eccbd51030fb3614，20项及cleanup全部通过。双publisher设备/码接入/MCP读页与cleanup均exit0。

补充边界证据（2026-10-02）：隔离 DB HTTP feature-off 门禁通过；waiting_review 继续读取、外部 HTTPS 图片、多子任务溢出均通过并完成清理；Sync v3 独立 HTTP 生命周期门禁 2/2 通过；Windows 真实远程 Session exit 0；Obsidian 1.13.7 原生 GUI Push 后服务端逐字回读、重载后映射与内容持久化通过。原生 Obsidian 本次连接的空间使用 Sync v2，因此不把原生 GUI v3 冒充已验证；v3 由独立 HTTP 门禁覆盖。

GitHub正式release [v0.12.11](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.11) 已于2026-10-01 18:56 CST发布（isDraft=false），标签对应已部署执行代码5638dd8d；master已推送后续仅文档的验收记录提交。
