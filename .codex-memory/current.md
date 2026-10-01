# 当前目标

- 修复 AgentwikiQ 2 全部20项及附加两条接入协议问题，完成正式发布、服务器部署和逐项验收。

# 范围 / 不做

- 本线程修复、审查、包发布、TLS及生产部署均获用户授权。
- 保留生产已有Assist修复，保留日常Vault与主仓脏文件；不弱化TLS/完整性/CAS/Agent权限。

# 当前状态

- 基线1335765cd，生产0.12.10。20项复核结果：16有缺口，Toast组件上线，插件/图谱/颜色原场景待验收。
- 按9组修复计划顺序实施。Task1接入契约与Task2权限/绑定已独立审查通过；Task3中文与协作入口已独立复审通过；Task4来源/审核刷新已独立复审通过；Task5继续指令与协作布局421d29c2+8169bbac独立复审通过；Task6图谱/图片5ad37040独立审查通过；Task3全仓文案断言/初始JS预算修正4cbe5bb6独立审查通过；完整客户端1618项/类型/lint/build通过，初始JS546154/550000B。
- npm protocol0.6.1已发布。公开Local Sync0.10.1存在Linux文件名大小写缺陷；0.10.2候选已修复、独立审查、干净安装与Linux运行验证通过，但正式发布等待npm硬件2FA。
- 插件0.5.6正式资产真实公网v2/PullPush/恢复/目录20项通过；非原生GUI，待新服务部署后复验。
- 最终候选5638dd8dc2fa961f29e436d095da23ad983846cb完整回归exit0：runtime263/DB216/server2754/client1630/protocol140/local-sync925，共5928通过、0失败、6既有或平台skip；类型/lint/build通过，lint有3条既有warning。Task7和整分支及Linux/测试夹具增量审查通过。
- 已推送GitHub分支codex/q2-defect-closure-v01211，远端HEAD核对一致。未合并master、未创建0.12.11 release、未激活生产。Linuxstage1421文件哈希与候选一致，构建/Assist预检通过，迁移无需执行。

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
- npm安全密钥验证链接曾超时；必须用户完成硬件验证后重新确认0.10.2公开包与Linux干净安装，才能激活应用。现生产0.12.10三服务active。
- 激活脚本已准备，部署时创建数据库+附件配对备份、核验清单后原子切换；随后运行真实onboarding/插件/Chrome业务验收及报告补充场景。全部20+2的生产闭环仍待完成，不能宣称全部已修复部署。
