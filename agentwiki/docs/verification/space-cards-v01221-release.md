# v0.12.21 空间卡片补修与发布验收

## 修复与独立审查

空间卡片的“最近更新”使用空间与活跃页面的最新更新时间，创建响应返回页面计数。新增回归覆盖正文更新、设置更新时间较新、空空间、授权分页边界、旧响应回退和新建统计。

独立审查确认 v0.12.20 复核发现的两项问题已关闭，没有新增阻塞；复核者的测试命令未能定位依赖，其结论仅为静态审查通过。运行测试以本记录后续门禁为准。

## 发布准备

- 应用 root/server/client 版本 `0.12.21`；无数据库 schema 变更。
- 专项测试：SpaceService 25 项、Dashboard 31 项通过；两端 TypeScript 与改动文件 ESLint 通过。
- 发布前备份 `/var/backups/agentwiki/cards-v01221.3zjZDWlu`：停止 API/Worker 写入后备份数据库和 84 个附件文件，数据库 dump 39,290,983 字节。附件 path/size/SHA256 对比一致；dump TOC、应用归档可读性和备份 SHA256 校验通过，服务恢复 active。

## 精确候选门禁

源码提交 `a2817cb34f3c80ae7b9f99bdd8f517e684b082cc`，tag `v0.12.21`。独立发布工作树运行全部门禁阶段，最终结果：

| 范围 | 通过 | 跳过 | 最终失败 |
| --- | ---: | ---: | ---: |
| runtime | 309 | 1 | 0 |
| PostgreSQL/Redis 数据库专项 | 230 | 0 | 0 |
| server | 3081 | 4 | 0 |
| client | 2258 | 0 | 0 |
| sync-protocol | 140 | 0 | 0 |
| local-sync | 985 | 1 | 0 |
| 合计 | 7003 | 6 | 0 |

首次 `test:full` 在客户端有一条既有 PageEditor 交互测试触发 5000ms 超时。相同源码与原超时断言单测 467ms 通过；完整客户端以 `--maxWorkers=2` 重跑 2258/2258 通过。其后同步协议和 Local Sync 阶段分别运行通过。没有把首次总命令描述为退出 0，也未调整产品代码或放宽测试超时。数据库与服务端已通过的阶段未重复运行。6 项跳过为既有平台/独立门禁限制。

服务端构建、两端 TypeScript、全仓 ESLint、客户端生产构建通过。初始 JavaScript 为 549824/550000 字节，保留既有循环分块与大分块提示。

GitHub 正式 Release 已发布：[v0.12.21](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.21)，非草稿/预发布。生产部署完成：root/server/client 均 0.12.21；1240 个部署源码文件 SHA256 匹配，环境文件哈希保持，三个服务 active/running、NRestarts=0，内外五项健康检查均 ok。

公网卡片专项 7 项通过：创建返回 0 页面/1 成员，正文编辑推进 lastUpdatedAt 且不改变 Space.updatedAt。公网通用 smoke 32 项通过，所有自有测试账号、Space、Agent 清理完成。已登录 Chrome 正式工作台展示真实页面/成员数，控制台无 warning/error。回读同时发现某个既有页面原始时间在未来，卡片的“8 小时后”提示由后续 v0.12.22 显示保护修复；未改动用户时间数据。

旧应用保留 `/root/agentwiki-previous-20261013150306`，配套备份见上。
