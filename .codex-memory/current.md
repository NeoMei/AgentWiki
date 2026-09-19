# 当前目标

- v0.12.1 已发布部署（生产验证通过）。v0.12.0/0.12.1：计划导入改造——三来源（粘贴/本地文件上传/空间页面 pageId 服务端直读，源标识=agentwiki-page:<id> 稳定对齐），字段改名「计划标识」并注明服务器不读本地文件；inspector 新增认领状态 box 与 takeover 勾选（多 Agent 协作可视化）。多 Agent 工作流已文档化（project-taskboard README/SKILL：report 自动认领、takeover、depends_on 门禁、push --sync-status）。
- 遗留：多页模板 v0.11.2 时期 7 篇空页面是否补入指南，仍待用户选择。

# 范围 / 不做

- 本次仅新增 ProjectBoard/ProjectBoardTask 与任务看板功能；Local Sync 0.10.0、协议 0.6.0、独立 Obsidian 插件 0.5.1 保持不变。
- 原 Python 看板的计划文件自动监听未移植；等价能力为 import-plan 接口 + sync_status 参数。

# 当前状态

- v0.11.7 发布完成：5aa57439 快进为远端 master；tag v0.11.7 与 GitHub release 已推送。含 schema 迁移 20260919230000（ProjectBoard.eventSequence + ProjectBoardEvent 表）。
- 发布前验证：server 150 suites / 2659 tests、client 107 files / 1506 tests 全绿；typecheck/lint/build/契约测试（node --test 33 项）通过。
- deploy.sh 经 root@113.249.120.24 部署：远端停服后 prisma migrate deploy 应用 20260919000000_add_project_taskboard，ProjectBoard/ProjectBoardTask 两表已建（DB 计数 2）。
- 部署后验证：三服务 active，api health 五项 ok，公网 UI 200、api health 200，taskboard events 路由未认证 401；线上版本 0.11.7，ProjectBoardEvent 表与 eventSequence 列已建。发布前 server 154 suites/2664 tests、client 109 files/1507 tests 全绿。
- 回滚点：/root/agentwiki-previous-20260919225946（v0.11.6；更早 220634 为 v0.11.5；不要在未恢复匹配数据库备份的情况下重新激活）。
- agentwiki-previous-20260919214605 为 v0.11.5 回滚点。
- v0.12.2 已发布部署：修复多 Agent 并发写缺陷（8 路并行曾 4×409 COLLABORATION_PROGRESS_INVARIANT；高频变更改 READ COMMITTED + 事件序号原子分配后，生产 3 轮×8 路 24/24 全 200、事件流无断号）。跨身份认领冲突端到端仍待第二 agent 凭据（单测覆盖）；验收空间「看板验收-20260919」(cmu8ir768004z142nhhryyq30) 保留，可自行删除。

# 稳定约束

- Folder 为目录，Page 承载正文；folderId 为事实源，权限/CAS/treeRevision 保持。
- 模板版本不可变，升级追加版本，不覆盖已有用户页面。
- 主仓路径末尾空格，Git 显式 --work-tree；保留根目录用户脏文件和其他工作树。
- 发布、部署、真实客户端验收独立记录；页面组沿用 Space allowlist。

# 关键索引

- agentwiki/docs/releases-v0.11.7.md
- agentwiki/docs/releases-v0.11.6.md
- agentwiki/docs/releases-v0.11.5.md
- worktree: /Users/neomei/项目/codexprojects/AgentWiki /.worktrees/taskboard-integration-20260919（分支 codex/taskboard-integration-20260919）
- tasks/archive/template-guidance-20260910/brief.md

- 跨身份认领冲突已在生产端到端验证：新签「看板协作Agent」(cmu8nf1vj0095bnlinau4rpwh, agk_ 在 ~/.agentwiki/credentials.json, editor@验收空间)。实测：Admin 认领中 → Agent 无 takeover 409 TASKBOARD_TASK_CLAIMED(claimed_by) → Agent takeover 200(接管链入档) → Admin 无 takeover 409 → Admin takeover 200。双身份闭环完成。