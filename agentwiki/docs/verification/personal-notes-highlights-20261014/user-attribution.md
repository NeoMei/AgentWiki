# 笔记用户归属补充验收

用户强调此 Wiki 支持多人、多 Agent 协作，因此笔记必须区分用户。

## 当前事实与改动

- 原模型每条笔记已有 userId / spaceId / pageId，三者同时用于存储键与记录校验；不同账号数据隔离，过期回调不能改变新账号笔记。
- 新增 PersonalNoteAuthor 供笔记卡片与输入浮层共用。卡片取每条记录的 userId，只有精确匹配登录账号才取其姓名/邮箱并标记“我”；其余显示对应用户 ID 或未知用户，不冒用当前账号。
- 浮层显示当前写入身份；切换账号时原有草稿同步隐藏并清空。长姓名/邮箱限制在容器内，完整身份保留在 title 与无障碍标签。
- 当前仍是本浏览器中的私人笔记。Agent 只收到显式选择发送的注释，其用户归属仍绑定私有会话/任务 requestedByUserId；外部 MCP Agent 没有这类本地笔记的 CRUD 接口。
- 已询问用户是否要默认私密可共享、全团队可见或继续私密。未获答复前不自动公开已有私人笔记。团队共享、Agent 作者和跨设备同步仍需服务端模型及权限接口，不能把本次作者 UI 描述为已实现这些功能。

## 验证

- 身份、存储与 Agent 回执相关 4 files / 100 tests passed：/tmp/note-identity-audit-tests.log。
- 作者 UI、卡片与浮层 3 files / 29 tests passed：/tmp/note-author-review-tests.log；包含两账号重新渲染、未知作者、退出登录、逐条作者和浮层切换账号。
- 根线程 PageEditor / PagePreview 定向 2 files / 188 tests passed：/tmp/note-owner-page-regression.log。
- 客户端生产构建通过（/tmp/note-owner-client-build.log）；TypeScript、定向 ESLint、diff --check 通过；独立审查通过。
- 本轮 Chrome 连接不可用，未完成新增作者标签的浏览器像素验收；无远程页面、笔记、MCP 权限或生产数据变更。
