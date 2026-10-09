# F6 独立修复审查 R5

APPROVE 本补丁。不是最终任务签收；真实新构建 template/UI、F5 GREEN 和清理仍由 root 提供。

审查基点 HEAD f844f44d0acc6fe41ed69109bbcf20d0d49ce8c2，实际未提交 diff 仅 CompositeTemplateCatalogService 的 canCreate 将 human admin 纳入，以及对应 catalog spec 增加四 human 角色、四 Agent 角色和 nonmember platform admin viewer 投影验证。没有修改生产授权或测试 skip。只读检查，未改仓库、无 API/DB/浏览器启动。

共享 AuthorizationService.assertLiveHumanSpaceAccess 调用 humanAllowedRoles，将 editor gate 对 human 扩展为 admin；TemplateInstantiationService 的 owner/editor + requireSpaceMembership 已允许实际成员 admin。catalog 原先 false 导致前端 NewPageDialog 降入 legacy；修复使投影与真实创建授权一致。非成员 super_admin 只读被投影 viewer，canCreate 仍 false；Agent 必须经过 HumanOnlyGuard 与 lockLiveHumanPrincipal，额外 !agentId 保护仍保留。

相邻检查：preview/detail 明确包含 admin 只读访问；managementDetail 与旧单页 canManage 均 owner/admin；instantiate 保留活用户锁、Space 锁、实时成员检查、tree revision 与幂等校验。TemplateFeaturePolicy 管理定义的 allowlist 未被此投影修改，实例化能力与定义管理开关本来分离。未发现此限定相邻范围的新可行动遗漏。没有把所有 owner/editor 数组表面误判为 admin 拒绝。

独立执行四套 Jest：composite-template-catalog.service、composite-template-preview.service、template-instantiation.service、authorization.service，4 suites / 83 tests 全通过、0 skip。原始日志 f6-independent-r5-tests.log。新增 Agent 参数测试是防御性投影 mock，不冒充 Agent 可访问真实 human-only HTTP 路由；真实 admin UI 仍需新构建验收。
