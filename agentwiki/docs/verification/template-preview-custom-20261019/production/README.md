# v0.12.54 生产发布验收

冻结源码 `e067fa3728b68db844d39e60f049801937f3cc96`，基于 v0.12.53；用户明确授权发布。正式版本 [v0.12.54](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.54) 已发布，标签指向该冻结提交；后续文档归档提交不改变部署源码。Web/API/client 0.12.54，Local Sync 0.13.4、protocol 0.6.1 保持，未发布 npm。

## 技术发布证据

- 本地全量构建成功，全部仓库测试阶段合计 8,109 passed / 6 既有 skipped。数据库 239 项零跳过。`validation.json` 保留首次缺测试环境失败和客户端并发超时的事实；完整客户端单 worker 2,756 项通过，源码、断言和 timeout 均未改。因此结论为分阶段通过，不是单次 `pnpm test:full` 一次通过。
- 配套备份 `/var/backups/agentwiki/templates-v01254.mexgfxtm` 包含数据库、应用、配置和附件；停止写入者后完成数据库与附件同一静止窗口快照，检查归档、pg_restore --list 和 SHA256SUMS。未执行恢复演练。
- 仅从冻结 Git 导出执行部署，旧应用保留于 `/root/agentwiki-previous-20261020000557`。
- 1,389 源文件全部匹配；三服务 active；服务端与公网五项健康均 ok；公网 index 和五个首屏资源哈希匹配；64 个迁移已应用，无待办/失败迁移；根与 server 的环境配置文件哈希保持。
- 部署日志中的启动期间 loopback 连接重试属于服务重启窗口；最后部署退出 0，随后独立技术回执通过。
- `source-manifest.json` / `verify-release.py` 可重复核对冻结发布；完整原始日志留在 `/private/tmp/agentwiki-template-release-20261019`，公开仓库保留摘要与 SHA-256。

## 生产用户路径验收

原项目日报正文缩略图、放大预览、自定义模板使用入口和页面组切页已通过真实登录浏览器检查。原项目当前用户为 editor，API canManage=false / canCreate=true，管理入口按 owner/admin 权限隐藏；未修改成员或权限。

独立临时私有 Space 的 owner 完成从页面创建模板→改名→归档→恢复→管理页直接使用→自定义分类预览→生成页面。源页和生成页分别 GET 读回，正文 SHA-256 完全一致。

生产共11项浏览器检查通过，0 console errors，0丢失请求。临时模板已归档；唯一临时 Space 已由官方 UI/API 软删除，完整授权列表读回确认精确ID不存在；未建立临时账号，原项目成员权限与业务文档未改。正常审计/软删除记录可保留。验收会话已停止。见 `production-ui-receipt.json`。

新建模板版本流程未在本次生产验收中重复，沿用本地套件验证；不声称覆盖所有产品能力。

## 本地与生产边界

上一层 README 与本地五条浏览器脚本使用内存 HTTP fixture，其结果仅证明本地组件交互。这里的生产回执来自实际部署、公开服务和原用户登录浏览器；两类证据分开保留。完整 UI 调试输出和带用户身份导航的截图保存在本地私有验收目录，不加入公开发布附件。

最终独立复审 status=passed，blockingFindings=[]，全部验收边界已核对。汇总见 `release.json`，公开版本回执见 `github-release-receipt.json`。
