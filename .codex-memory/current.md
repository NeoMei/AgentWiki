# 当前目标

- 修复服务端平台超管跨 Space 创建页面的授权缺陷，并完成回归验证。

# 范围 / 不做

- 空页面、传统单页面模板、复合模板实例化的页面创建必须经过真实 `SpaceMember` 校验；平台超管仍可按既有规则读取未加入的 Space。
- 本轮只修改服务端授权与回归测试，不发布或部署；Windows 原生同步和日常 Vault 安装不属于本轮验收。

# 当前状态

- 根因确认：平台 `super_admin` 在通用 Space 授权中被直接映射为虚拟 `owner`，绕过了真实成员记录。
- 已新增 `requireSpaceMembership` 严格选项，并在页面 HTTP 入口、页面事务和模板实例化事务内同时启用；非成员超管在写入前返回 `SPACE_ACCESS_DENIED`。
- server 全量测试 151 suites / 2643 tests 通过，类型检查、lint、build 通过；既有跳过项保持。

# 稳定约束

- Folder 为目录，Page 承载正文；权限、候选基线、CAS 与 treeRevision 必须保留。
- 平台超管的跨 Space 读取能力保持；页面创建必须有真实成员身份并满足 owner/editor 写入角色。
- 主仓路径末尾空格；Git 使用显式 `GIT_DIR` / `GIT_WORK_TREE`，保留根目录用户脏文件和其他工作树。

# 关键索引

- `agentwiki/apps/server/src/core/authorization/authorization.service.ts`
- `agentwiki/apps/server/src/core/page/page.controller.ts`
- `agentwiki/apps/server/src/core/page/page.service.ts`
- `agentwiki/apps/server/src/page-templates/template-instantiation.service.ts`

# 风险 / 下一步

- 修复尚未发布或部署；如需上线，先提交并重新执行 release/deploy 验收。
- Windows 原生同步现场仍需独立复测，不要用便携测试替代原生证据。
