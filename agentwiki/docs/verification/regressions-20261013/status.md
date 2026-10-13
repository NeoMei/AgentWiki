# 10-12 回归修复发布与逐条回执

v0.12.24 已发布并部署生产，源码 `7708a426aa88090f364d2de276acfce779e6085c`。
[Release](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.24)；[完整 21 项回复](reply-v01224.md)。

## 最终验证

- 独立复审最终代码无 P1/P2；完整门禁 7050 通过、6 项既有环境跳过、0 失败，数据库 232 无跳过，client 2298 通过。构建、类型、lint 通过，首屏 JS 546422/550000 字节，见 [gate-v01224.json](gate-v01224.json)。
- 生产 1244 个源码/配置文件匹配发布提交，root/server/client 均 0.12.24；两份环境文件校验不变。API/Worker/Frontend 均 active/running、NRestarts=0，内外 health 五项全 ok；首页 200、index 与 5 项入口资源匹配，见 [production-v01224.json](production-v01224.json)。
- 61 个已有迁移为最新，无新增迁移。公网 smoke 32/32 通过，自有测试资源已清理；Local Sync 与 Obsidian 未发版。
- Chrome 验收预览不提前报协作缺项、提交时具体 Toast 和输入/角色聚焦、返回清错、单页同名提交中文拦截、引用文档输入提示，见 [browser-v01224.json](browser-v01224.json) 及截图。表单已取消，无新增 Page/Run，无 Agent 消息。
- 6 项跳过为 CodeGraph opt-in 1、server 专用 CONNECTION_UX_DB_TEST 3、Windows OpenCode 1、local-sync Windows ACL 1。

## 备份和回滚

部署前备份 `/var/backups/agentwiki/regressions-v01224.STptFpy7`，数据库 40029276 字节，应用归档 351782218 字节；备份校验与附件 live manifest 匹配。旧应用保留 `/root/agentwiki-previous-20261013184857`。

## 逐条反馈与未闭环边界

最终反馈 ChangeSet `cmv6ki9jb00agfsg0v1m9sgr2` 已提交并读回，21 项内容逐字匹配；当前为 `pending_review`，尚未成为正式页面。需要 Space 所有者 xuehui 审批；当前浏览器用户 MeiXueFeng 与 codex Agent 均为 editor，不能审批。最终反馈明确取代早期 `cmv69bve2080911615gw5fz6w` 中过时判断，未绕过授权。

- #4 已查明旧 Agent 暂停且失去 Space 授权，历史模板已归档；未改运行或权限。#7 当前只读检查未见阻断，仍待原账号浏览器复验，详见 [original-run-readback-v01224.md](original-run-readback-v01224.md)。
- #9 父子完成规则待产品决定；#12 新增删除 Agent 未实施；#13/14/15 输入时即时校验未实施，已交付提交时原子校验及本地化提示。
- 原生中文输入法、原附件权限、原长文目录和有管理权限视角保留对应环境验收。

## 失败记录与修正

首轮 v0.12.24 既有 DB 用例超时严格对应 macOS 休眠 489 秒，同组隔离重跑 5/5。第二轮客户端既有取消导航测试暴露 close 提前取消，修正一行并保留原测试；57 项相关测试和最终完整门禁均通过，没有提高超时或删减测试。详见 [followup-review-v01224.json](followup-review-v01224.json)。

v0.12.23 发布及早期验证记录保留在 [status-pre-v01224-production.md](status-pre-v01224-production.md)，仅作历史追溯。
