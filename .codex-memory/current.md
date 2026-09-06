<!-- codex-memory:template=current:v1 -->

# 当前目标

- 从原 Session 恢复空间名 32 字符限制：完成普通新建/改名、Agent 自助接入校验、旧长名称兼容及窄屏布局修复。

# 范围 / 不做

- 本轮只完成本地实现、验证、独立审查和功能分支提交；不自动合并 master、push、发布 npm 或部署生产。
- 不移动原工作树，不重做已完成的组合模板功能，不修改其他并行工作树。

# 当前状态

- 原任务 ID：01a06f37-1d32-7231-9e99-a9c0a1c6312a；实际工作树 `/Users/neomei/.codex/worktrees/69d8/AgentWiki ` 末尾带空格，缺空格路径已建立兼容符号链接。
- 分支 `codex/composite-page-group-agent-collaboration`，本轮起点 9e6dc9a9（v0.9.0 发布验收记录）；先前 current.md 的“未发布”描述已过时，线上本轮未复验。
- 新建、改名以及 onboarding 创建均按 trim 后最多32个 validator.js 单位校验；不静默截断。旧名称不变时，设置 PATCH 不携带 name，允许保存其他设置。
- CLI 在授权和确认之前校验长度并trim。服务端以原始确认计划算 hash；Space 存储trim后的名称，但 bootstrap回执及replay保留原始确认名称，兼容已发布旧CLI严格比对。
- 列表、标题、面包屑窄屏布局及中英文提示已验证。Chrome 390x844 / 1440x900，dev 5189及本地生产构建5190；UI使用隔离HTTP fixtures，无生产写入。
- 独立审查已修正遗漏的Local Sync E2E测试名、旧CLI回执兼容和CLI提前校验；最终独立审查 Critical/Important 0。分阶段检查5265通过/3跳过；runtime258+1、DB175零skip、server2536+1、client1270、protocol140、local-sync886+1。

# 稳定约束


- Folder只表达目录结构；只有Page可以绑定Agent或成为任务目标。
- PageAgentBinding不授予权限；活动Run冻结负责人；参与者仅来自本次启用任务并按Agent去重。
- 模板实例化Folder/Page/Binding/Run和一次tree revision全有或全无；外围任务提交后重试。
- 页面目标产物走Artifact+ChangeSet+一次人类审核；实时权限与版本冲突检查不得绕过，精确receipt重试保留。
- 旧单页/旧Run兼容，历史页面可后绑定；Space旧流程显式升级。
- v3已发布ChangeSet禁止旧入口回滚；协作候选不可走普通入口绕过协作审核发布。
- AgentGrant.role是权限事实源，Agent没有review:decide；外部Agent人工审核后的恢复仍需用户明确唤醒。

- 空间名称长度按 class-validator/validator.js 规则计数，包含 surrogate pair / variation selector；不要改成 HTML UTF-16 maxLength 或静默截断。
- Onboarding raw plan hash与精确replay不允许因名称规范化改变。

# 关键索引

- 原任务恢复备份：`/Users/neomei/.codex/recovery/agentwiki-session-20260906-180349/恢复记录.md`
- 验证日志、浏览器脚本和截图持久副本：`/Users/neomei/.codex/recovery/agentwiki-session-20260906-180349/completed-validation/`。
- 既有发布记录：`agentwiki/docs/verification/composite-v090-release.md`
- 原组合模板设计：`agentwiki/docs/superpowers/specs/2026-09-05-composite-page-group-agent-collaboration-templates-design.md`

# 风险 / 下一步

- 本地修复及独立审查完成，待有明确请求再合并、push、发布或上线。
- 全量命令前端阶段曾出现未改动PageEditor测试的1秒等待超时；单文件53通过，随后低并发完整前端93文件/1270测试通过。保留失败日志，不能称首次全量命令exit0；其余阶段全部通过。
- 类型检查、lint、server/client/Local Sync构建通过。数据库清理后public表0、临时测试schema0、额外连接0；Vite保留既有chunk-size建议。
- 实际根目录和worktree均以空格结尾；共享core.worktree会误导默认Git命令，每次显式 --work-tree 指定实际工作树。
- 专用验证PG 127.0.0.1:50415 / agentwiki_composite_test、Redis50416；必须随机schema并清理，禁止业务库与共享public测试写入。
- 原任务 adapter_eof 仍是独立运行时问题，目录链接恢复不代表已解决模型流断开。
