<!-- codex-memory:template=task-decisions:v1 -->

# 页面模板库决策

- 选择单页模板，不做一次创建多个页面的套装。
- 选择“系统模板 + Space 自定义模板”，不是只有内置模板。
- 首发入口为：空白页面、任务清单、项目管理、日报、周报、会议纪要、决策记录、复盘总结。
- Space 模板只允许 Owner / Admin 创建、更新、归档和恢复；Editor 只使用。
- 使用模板创建页面继续遵循现有 `pages:write`：当前 Owner / Editor 可创建，Viewer 不可，不因模板功能扩张 Admin 的页面写权限。
- Agent 不使用模板来源字段，也不管理页面模板。
- 自定义模板是独立快照，原页面修改不自动传播；更新生成不可变新版本。
- 新建页面使用两步式弹窗：先选模板，再填写标题和父页面。
- 模板正文由服务端根据指定模板版本复制，客户端不把正文作为可信模板提交。
- 系统模板双语；Space 模板保持作者原始语言，不自动翻译。
- 数据库验收必须使用专用 `PAGE_TEMPLATE_TEST_DATABASE_URL` 与随机 `page_template_test_*` schema，绝不使用 `public`。
