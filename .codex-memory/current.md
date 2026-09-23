# 当前目标

- 修复登录后账号入口、头像和本人 Agent 在个人资料下不可见的问题。

- v0.12.5（页面组 owner/editor 创建权限修复，1817684b）已完成 GitHub 发布；生产已部署并完成健康检查。
- v0.12.4（画布任意深度同步 ba771da）已发布部署。
- v0.12.3（三阶段聚合对齐上游 ba67015）已发布部署。
- 修复服务端平台超管跨 Space 创建页面的授权缺陷，并完成回归验证。

# 范围 / 不做

- 空页面、传统单页面模板、复合模板实例化的页面创建必须经过真实 `SpaceMember` 校验；平台超管仍可按既有规则读取未加入的 Space。
- 本轮修改服务端页面组创建授权与回归测试并发布 v0.12.5；生产部署已完成；保留上一版本目录与 v0.12.5 配对备份。Windows 原生同步和日常 Vault 安装不属于本轮验收。

# 当前状态

- 本轮前端修复已完成：导航栏使用用户姓名/邮箱首字母头像，个人菜单明确显示账户身份与个人资料入口；个人资料页并行加载 `/users/me` 与当前用户拥有的 `/agents`，展示 Agent 列表和详情/管理链接。
- 针对性客户端测试 3 files / 8 tests 通过，客户端 TypeScript 检查和生产构建通过；2026-09-23 已部署到 `root@113.249.120.24:/root/agentwiki`，数据库无待迁移项，API/Worker/Frontend active，公网 `/api/health` 五项均为 ok。
- 已通过登录态浏览器验收：顶部显示姓名首字母头像与个人菜单，`/profile` 显示“我的智能体”及 3 个 Agent 详情链接。

- 根因确认：平台 `super_admin` 在通用 Space 授权中被直接映射为虚拟 `owner`，绕过了真实成员记录。
- 已新增 `requireSpaceMembership` 严格选项，并在页面 HTTP 入口、页面事务和模板实例化事务内同时启用；非成员超管在写入前返回 `SPACE_ACCESS_DENIED`。
- server 全量测试 151 suites / 2643 tests 通过，类型检查、lint、build 通过；既有跳过项保持。

# 稳定约束

- Folder 为目录，Page 承载正文；权限、候选基线、CAS 与 treeRevision 必须保留。
- 平台超管的跨 Space 读取能力保持；页面创建必须有真实成员身份并满足 owner/editor 写入角色。
- 主仓路径末尾空格；Git 使用显式 `GIT_DIR` / `GIT_WORK_TREE`，保留根目录用户脏文件和其他工作树。

# 关键索引

- `agentwiki/apps/client/src/components/UserAvatar.tsx`
- `agentwiki/apps/client/src/components/Navbar.tsx`
- `agentwiki/apps/client/src/features/profile/Profile.tsx`
- `agentwiki/apps/client/src/features/profile/Profile.spec.tsx`

- `agentwiki/apps/server/src/core/authorization/authorization.service.ts`
- `agentwiki/apps/server/src/core/page/page.controller.ts`
- `agentwiki/apps/server/src/core/page/page.service.ts`
- `agentwiki/apps/server/src/page-templates/template-instantiation.service.ts`

# 风险 / 下一步

- v0.12.5 已提交、推送、创建 GitHub Release，并部署到 root@113.249.120.24；线上 API、Redis、数据库、审计持久化、附件存储和前端健康检查通过。
- 本次部署备份：`/root/agentwiki-backups/20260923175014`；旧版本保留：`/root/agentwiki-previous-20260923175153`。备份 SHA256 已在部署终端输出中记录。
- Windows 原生同步现场仍需独立复测，不要用便携测试替代原生证据。
