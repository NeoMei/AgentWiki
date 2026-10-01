# AgentwikiQ 2 修复与发布验收

当前状态：进行中。应用尚未发布/部署0.12.11，不宣称全部已修复。

权威原报告：主工作区 测试报告/AgentwikiQ 2/问题清单-缺陷详情09-29.md、agentwiki-onboard-diagnosis.md。基线1335765cd；工作树d35c末尾空格。

|项|范围|实现/针对性检查|候选上线验收|
|---|---|---|---|
|1|去掉新Git来源|Task4 f74ff78d+edfa4f92+1ba9e1e2，独立复审通过|待部署|
|2|协作中文|Task3 df8ffa92+1bea7636，独立复审通过|待部署|
|3|Toast自动消失|既有0.12.10|待整体验收|
|4|中文错误|Task3复审通过|待部署|
|5|角色中文|Task3复审通过|待部署|
|6|公网TLS|已补齐实际终止点证书链；Node默认信任200|已验证，最终复验待部署|
|7|Obsidian目录/同步|正式0.5.6资产与真实公网20项通过|新服务部署后复验；非nativeGUI/Windows|
|8|协作管理导航|Task3复审通过|待部署|
|9|审核加载/刷新|Task4独立复审通过|待部署|
|10|独立页面/目录绑定|Task2独立复审通过|待部署|
|11|人工审核文案|Task3复审通过|待部署|
|12|重新进入继续指令|Task5 421d29c2+8169bbac，256测试/本地Chrome布局/独立复审通过|待部署|
|13|协作卡片布局|Task5 421d29c2+8169bbac，256测试/本地Chrome布局/独立复审通过|待部署|
|14|图谱标签|Task6 5ad37040，137测试/Chrome2/独立审查通过|待部署|
|15|来源运行结果|Task4独立复审通过|待部署|
|16|非成员平台管理员只读|Task2复审通过；真实DB69项通过|待部署|
|17|图片放大|Task6 5ad37040，页面/预览图片测试与独立审查通过|待部署|
|18|看板子任务对齐|Task7 5d43006a，24客户端/50服务端/Chrome2通过，整分支审查通过|待部署|
|19|实现阶段随任务状态更新|Task7 5d43006a，中央补丁/服务/MCP覆盖，不捏造验证验收|待部署|
|20|待验收紫点|Task7 5d43006a，真实Chrome计算颜色与图例通过|待部署|
|附1|一次性码publisher接入|protocol0.6.1公开；local-sync0.10.2候选双路径契约通过，正式包待2FA发布|正式包及新服务部署后复验|
|附2|device-flow publisher接入|同上，保持rawServerPlan/16scopes/篡改拒绝|新服务部署后复验|

最终候选：`5638dd8dc2fa961f29e436d095da23ad983846cb`。逐任务与整分支复审，以及Linux导入/测试夹具增量审查全部Approved，0 Critical / 0 Important。GitHub分支`codex/q2-defect-closure-v01211`已推送并核对远端HEAD；尚未合并master或创建正式release。

最终完整回归 `pnpm test:full` exit0（`/private/tmp/agentwiki-q2-final-fulltest-4.log`）：runtime263、数据库216、服务端2754、客户端1630、protocol140、Local Sync925，共5928 pass / 0 fail / 6既有或平台skip。数据库零skip。类型/lint/build通过；lint有3条既有unused参数warning。初始JS546154/550000B，未增加预算。4cbe5bb6文案196entries/语言及顺序保持。

失败历史保留：首次并行构建清理dist造成两处模块导入失败；后续DB夹具遇到PostgreSQL TIMESTAMP(3)与JS毫秒取整的1ms竞态。5638dd8d仅将两处已应到期的测试任务设为明确过去时间，生产重试/栅栏及断言不变，独立审查和最终完整重跑通过。

Linux暂存构建发现MCP SDK `streamablehttp.js`导入大小写错误；公开0.10.1亦有该缺陷。d62655b5修复为实际`streamableHttp.js`并准备Local Sync0.10.2。候选包干净安装、双publisher原始计划/16scopes/篡改拒绝及Linux CLI/gateway导入通过。protocol0.6.1保持已发布不变。0.10.2正式包尚未发布：npm要求账户安全密钥验证，等待用户硬件认证，registry当前404。

服务器暂存候选完整构建、Assist预检、1421文件哈希核验通过；最终archive SHA256 `60abdb51392b9d1e01a2645f1c781127e1c4bcc2757427b54143d22ae70ff472`。保留1848个既有客户端资产，三份Assist修复源文件与生产一致，60个迁移文件字节一致，无需迁移。生产仍0.12.10，API/worker/frontend均active。部署时的配对备份/原子激活及真实公网20+2业务验收尚未执行，不能将暂存构建视为部署完成。

剩余门禁：用户完成npm硬件2FA → 0.10.2公开包与Linux干净安装核验 → 配对备份及候选激活 → 真实onboarding、插件与Chrome业务验收/补充原场景 → 正式GitHub release。
