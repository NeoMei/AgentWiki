# 通知未读计数补修 v0.12.58

原报告：[10-22Agentwiki测试问题，第12项](https://agentwiki.quukk.com/pages/f31ccf05-70d0-4376-95c3-f507a5bb1bce)。

## 根因及修复

v0.12.57修复了通知页、铃铛及跨标签页的失效刷新，但服务端 `NotificationService.list` 的 `unreadCount` 使用 `visibleWhere(principal, false)`，遗漏 `readAt:null`，因此把所有可见历史通知当成未读数。`markRead` 和 `markAllRead` 原本就按 `readAt:null` 更新，已读记录返回 updated=0 是正确幂等行为。

生产只读事务调用实际旧服务验证：原报告账号有1条可见通知且已读，全部列表返回未读1，未读列表为空但仍返回未读1。不是浏览器缓存；无需迁移或重写已读状态。

最小修复为计数改用 `visibleWhere(principal, true)`。页面/Space删除、当前成员资格、接收人过滤保持。Local Sync0.13.5及protocol0.6.1无需发布或改动；npm latest尚未切换是独立遗留认证步骤。

## 验证

- 新真实 PostgreSQL 回归，旧实现4个子场景均失败；修复后5pass（含父test）/0fail/0skip。覆盖已读历史、新Prisma连接、混合已读/未读、分页外计数、未读模式、单条/全部已读与幂等、跨用户及删除/撤成员边界。
- 新计数查询契约断言也先红后绿。原测试的count固定返回1，未检验未读过滤；此前合成API客户端验收无法发现服务端计数问题。
- 服务端全套3591pass/3既有专用环境skip；前端通知3文件9pass；服务端类型检查、定向ESLint、服务端/客户端构建通过。
- 源码冻结提交 `19da88ebc90c9213a3835403c69f60e3669c5d86`。干净detached checkout的实际部署输入1423文件，与冻结源码无多余/遗漏/hash差异。
- 新配对备份 `/var/backups/agentwiki/notification-v01258.uqg3e9fw` 验证1422条旧版源码、DB自定义dump目录、配置和完整附件清单及10项校验；写服务暂停约10.3秒并已恢复。保留上轮备份/旧应用树，不把旧应用单独作为恢复操作。未做恢复演练。

## 线上验证边界

v0.12.58已部署；1423源码、HTML/5公网入口资源、三服务/五项health全部通过，65迁移无pending。生产实际NotificationService只读诊断：原billy数据全部列表保留1条已读历史且未读0，未读列表为空且计数0；通知ID/readAt状态哈希前后一致。源码提交、GitHub Release及原报告追加回复已发布并回读，18图及原人工失败原文完整保留。浏览器当前登录MeiXueFeng，未切换为billy；原billy浏览器单条/全部/跨标签人工复验须保留独立结论，不能用后台诊断冒充。

GitHub Release：https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.58

本轮previous应用树 `/root/agentwiki-previous-20261023220511` 保留。真实浏览器仅用当前MeiXueFeng读回原报告补充内容、历史失败结论及18图元素，未对其创建测试通知或修改账号；本地owned PostgreSQL临时DB和随机schema均已清理。
