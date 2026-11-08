# 当前目标

Agent所有者可见性修复已随v0.12.66正式GitHub发布并部署生产，本轮发布完成。冻结源436a3101fe7bd4de240ae8edc82be5ac7261d8e3。

# 范围 / 不做

列表、详情、空间成员、页面/目录绑定、协作角色、任务改派显示真实所有者姓名及账号，支持中英/未知所有者降级/手机换行。权限及生产配置保持；包括已有Quukk支持及空网关兼容修正。LocalSync0.13.5/protocol0.6.1不变。

# 当前状态

- v0.12.66已正式Release及生产部署；1470源码匹配冻结源，三服务active/五healthok，公网HTML与五入口资源一致。
- 完整8562pass/0fail/9条件skip，types/lint/全包build及独立复核通过；初始JS550838/551000。
- 两个生产环境文件哈希完全保持。旧生产1469源码均对应已知.65或f100ea9a，无未知修改。
- 配对应用/配置/DB/附件备份与随机隔离恢复通过。生产真实Chrome两个临时同名owner/Agent的8项API/UI/权限/中英/390px验收通过，7项资源清理均读回。
- 首轮整体因验收脚本opaque localStorage初始化失败，8业务项与7清理项仍全过；失败保留，修正脚本先红后绿8/8并最终生产通过。产品冻结源未改变。
- 绑定/协作选择器为本地组件证据；生产未创建Page、保存绑定、颁发凭据或请求模型。原未跟踪design/8稿保持。

# 稳定约束

canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`，便捷入口 `/Users/neomei/项目/codexprojects/AgentWiki-current/agentwiki`，分支 `codex/agent-autochat-external-opencode`；origin直连GitHub。编辑发布前guard，历史检出禁止发布；deploy.sh打包工作树，须用冻结clean detached树，worktree根读取当前配置并确认外置卷。生产root@113.249.120.24:/root/agentwiki；保留design/。不记录认证材料。

# 关键索引

- tasks/archive/agent-owner-release-20261109/{brief,decisions,refs}.md
- agentwiki/docs/verification/agent-owner-release-v01266-20261109/README.md
- https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.66
- archive/2026-11-09-agent-owner-visibility.md
- tasks/archive/space-review-release-20261028/{brief,decisions,refs}.md
- tasks/index.md（既有原环境未验边界）

# 风险 / 下一步

9skip为CodeGraph opt-in1、专用connection DB3、专用taskboard DB4、Windows ACL1；原账号/原生客户端及前次复制线上实点待验保留。备份`/var/backups/agentwiki/agent-owner-release-v01266.LfsNJki6`与旧应用`/root/agentwiki-previous-20261109012353`保留，回滚须考虑备份后新写入，不能恢复旧库覆盖新业务。551000字节初始JS门禁保持。
