# v0.12.20 空间卡片发布与生产验收

## 发布身份

- GitHub Release：[AgentWiki v0.12.20](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.20)
- 发布 tag：`v0.12.20`
- 发布提交：`81c1c9f4`（`feat(dashboard): enrich space cards`）
- `master` 已快进到该提交；发布分支为 `codex/release-v0.12.20`。
- root/server/client 版本均为 `0.12.20`；Local Sync、同步协议、数据库迁移和用户正文保持不变。

## 代码门禁

- Dashboard 定向测试：28/28 通过。
- 客户端完整 Jest/Vitest 套件：141 个测试文件、2255 项通过。
- 服务端完整 Jest 套件：166 个套件、3055 项通过，26 项既有数据库相关测试跳过。
- 客户端 TypeScript、任务文件 ESLint、服务器构建、客户端生产构建均通过。
- 生产构建保留仓库既有循环分块和 bundle 预算提示，没有新增失败。
- 仓库总 harness 在当前机器未配置专用数据库/Redis 门禁时有 10 项环境失败（包括 `PAGE_TEMPLATE_TEST_DATABASE_URL` 缺失）；这些门禁没有被表述为通过。本版仅改动客户端空间卡片和版本文档，服务端单测与发布脚本均已通过。

## 服务器部署

- 目标：`root@113.249.120.24`，实时目录 `/root/agentwiki`。
- 使用 `deploy.sh` 完成冻结锁安装、共享包/协议/服务端/客户端构建、OpenCode preflight、无待执行迁移、原子切换和旧版本保留。
- 三个用户级服务均为 `active`：`agentwiki-api.service`、`agentwiki-worker.service`、`agentwiki-frontend.service`。
- `GET http://127.0.0.1:3000/api/health` 返回 `status/database/redis/auditPersistence/attachmentStorage=ok`。
- 本地前端返回 HTTP 200；公网 `https://agentwiki.quukk.com/api/health` 返回同样的五项 `ok`，首页返回 HTTP 200。
- 发布源码中 4 个卡片文件和 3 个版本文件与服务器逐文件 SHA256 一致。
- 旧应用树仍保留在服务器的 `agentwiki-previous-*` 路径，回滚须匹配数据库与附件快照。

## 正式浏览器回读

已登录 Chrome 打开 `https://agentwiki.quukk.com/dashboard`，读到新版空间卡片：

- 系统问题缺陷管理：始终审核、4 个页面、4 位成员、最近更新 3 小时前。
- 黄金书屋：始终审核、89 个页面、3 位成员、最近更新 3 小时前。
- 我的知识库：限定范围自动发布、9 个页面、1 位成员、最近更新 3 周前。

每张卡片的“进入空间”链接、图谱入口和删除操作均可见；本次浏览器验收没有创建、删除或修改任何真实空间和页面。
