# 新空间审核默认与显著入口

状态：已随v0.12.65正式发布部署，发布验收见同级space-review-release-20261028/。用户授权新空间默认无需审核、创建时可选、设置入口明显，具体方案自行决定。基线dce0f764；复制按钮补丁保留；当前生产仍v0.12.64。

交付：普通API、数据库future default与快速接入新建都统一no-review；创建表单直接提供两种选项；空间标题旁显示当前策略，owner点开即可修改；设置页顶部独立卡片，policy单独保存并与header同步，保留name/description草稿。

既有Space不回填，旧接入记录恢复保留合法原值；owner-only、Grant/Agent权限不变；已有待审ChangeSet不自动批准。仅ALTER DEFAULT迁移经独立审阅，SQL/新旧corpus哈希回执位于docs/verification/migration-corpus-20261028-space-review-policy.md。

验证：完整test:full退出0，8540pass/0fail/9条件skip；真实PG默认/旧值保留与no-review/always-review MCP发布已包含；client TypeScript/定向lint/build通过，初始JS550626/551000；独立backend与UI复审无未关闭问题；本地真实Chrome10项通过，覆盖创建两策略、标题入口、失败重试、草稿保留、同步、390px/键盘/非owner只读。浏览器使用实际React组件+内存API fixture，无生产写入。临时本轮数据库/preview server/browser已清理，历史非本轮数据库保留。
