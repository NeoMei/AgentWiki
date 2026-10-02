# 当前目标

- 修复 AgentwikiQ 2 全部20项及附加两条接入协议问题，完成正式发布、服务器部署和逐项验收。

# 范围 / 不做

- 本线程修复、审查、包发布、TLS及生产部署均获用户授权。
- 保留生产已有Assist修复，保留日常Vault与主仓脏文件；不弱化TLS/完整性/CAS/Agent权限。

# 当前状态

- 基线1335765cd；20项及2条附加接入问题修复候选5638dd8d已部署生产0.12.11，服务正常。
- 按9组修复计划顺序实施。Task1接入契约与Task2权限/绑定已独立审查通过；Task3中文与协作入口已独立复审通过；Task4来源/审核刷新已独立复审通过；Task5继续指令与协作布局421d29c2+8169bbac独立复审通过；Task6图谱/图片5ad37040独立审查通过；Task3全仓文案断言/初始JS预算修正4cbe5bb6独立审查通过；完整客户端1618项/类型/lint/build通过，初始JS546154/550000B。
- npm protocol0.6.1/LocalSync0.10.2正式公开，0.10.2 SHA1 4723623a626c674fa8051c465bf805c95e943393与候选一致；Linux公网干净安装、CLI/gateway运行通过。旧0.10.1存在Linux文件名大小写缺陷，已用新patch修复。
- 插件0.5.6正式资产新服务公网v2/PullPush/恢复/目录20项通过且清理成功；Obsidian 1.13.7原生GUI隔离Vault连接/嵌套映射/Pull/Push/服务端回读/重载持久性通过；原生连接为Sync v2，v3由独立HTTP门禁覆盖。双publisher device/code正式公网接入、16scopes/rawplan/tamper/MCP读页及凭据/JWT401清理通过。
- 最终候选5638dd8dc2fa961f29e436d095da23ad983846cb完整回归exit0：runtime263/DB216/server2754/client1630/protocol140/local-sync925，共5928通过、0失败、6既有或平台skip；类型/lint/build通过，lint有3条既有warning。Task7和整分支及Linux/测试夹具增量审查通过。
- 已推送GitHub分支codex/q2-defect-closure-v01211，远端HEAD核对一致。已fast-forward推送master，v0.12.11正式release已发布，标签5638dd8d与生产执行代码一致。生产1421文件哈希与候选5638dd8d一致，三服务active/publicTLS健康五项ok；Assist保留，迁移无需执行。

# 稳定约束

- 路径末尾空格；所有git显式--work-tree，勿改core.worktree。
- 不以完整tag覆盖生产未收录的Assist修复。
- 平台管理员无真实空间成员关系只能读；验证/验收不能由任务状态造假完成。

# 关键索引

- agentwiki/docs/superpowers/plans/2026-10-01-q2-defect-closure.md
- .superpowers/sdd/2026-10-01-q2-defect-closure/progress.md
- 测试报告AgentwikiQ 2/复核结果-2026-10-01.md（原主工作区）

# 风险 / 下一步

- 公网TLS终止点47.108.85.222证书链已补齐；Node默认信任健康200。npm已验证发布；DB迁移审查哈希已更新并通过runtime门禁。
- 配对备份/var/backups/agentwiki/q2-v01211-20261001182522已核验，旧应用保留；npm硬件认证已成功不再阻塞。
- Chrome Q1..5/Q8..10/Q12..20实际检查通过，Q11真实审核提交/通过/中文状态独立补验通过；Q12paused真实恢复运行也通过；所有fixture清理且JWT/Agent401。Q10生产模板开关开启，feature-off边界公网未覆盖；Q17外部HTTPS图片/Q18多子溢出亦待补验。正式release及主要验收已完成；Q12waiting_review单独读取、Q10featureoff、外部HTTPS图、多子overflow与nativeGUI/Windows/v3保持未覆盖边界，不宣称全部原场景均通过。
