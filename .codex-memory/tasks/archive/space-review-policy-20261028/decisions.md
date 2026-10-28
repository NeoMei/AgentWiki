# 决策

- 用户已授权具体方案自行决定，不重复请求设计确认。
- 复用现有approvalPolicy两种规范值always-review/no-review，scoped-auto-publish作为历史兼容别名保留。
- SpaceView共用空间标题旁放当前策略，覆盖空间栏目与页面；owner可打开ModalDialog修改，成员看到状态，不扩admin/Agent权限。
- Settings审核独立卡片移至顶部，基本资料保存不再携带策略，避免覆盖快捷修改；只同步policy事件，不刷新或丢失名称/描述草稿。
- 新创建普通/快速接入默认no-review，恢复已有bootstrap接受原合法策略并保留原值。
- 仅ALTER DEFAULT，不回填既有Space，不自动批准待审ChangeSet。

- 同Space GET与快捷保存使用epoch：只覆盖保存前已发起的旧请求；之后的新GET信任server，避免旧事件长期pin策略。
- Settings基本PATCH和response仅name/description；独立policy事件只更新policy，不丢草稿。账号/空间/权限变更卸载旧编辑器，迟到响应不广播。
- no-review MCP真实DB fixture须安装现有应用BigInt序列化；生产已有启动安装，没有修改MCP序列化或审批服务。
