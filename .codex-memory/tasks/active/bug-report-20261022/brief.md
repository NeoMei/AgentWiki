# 目标

逐项修复并回写《10-22Agentwiki测试问题》12项；原页 f31ccf05-70d0-4376-95c3-f507a5bb1bce，项目管理 Space cmtmgsk5b00neuo709n0x7nqj。

# 当前状态

- 新会话真实 MCP list_spaces/get_page 已成功，新身份权限无需再授权。
- 12项已完成本地修复；#7依据现有关系唯一约束明确按同向/同类型过滤，保留不同类型、反向、自动转手动。
- 独立审查发现旧图谱hash跳过ID补建，已补版本盐及旧hash升级回归，复审无阻断。
- 前端169文件2814项全通过；本地Chrome17项通过；三端build、全typecheck/lint通过。浏览器为真实组件+合成API，不等于生产验收。
- 迁移corpus锁遗漏、正向注册夹具及模板测试异步/文字选择器竞态均已修复并复审；未放宽产品认证、数据库保护或测试timeout。最终分组8202通过、5环境限定跳过；runtime数据库239项0skip，server3572、client2814、协议140、local-sync1123通过。单次test:full停在旧client测试，修测试后完整client及剩余包另跑通过，不声称单次全仓exit0。
- 原报告已逐项追加并发布：12条开发回复+12条回归，MCP精确回读及Chrome渲染通过；移除新增回复后与原文逐字一致，18图保留。
- 产品代码尚未提交、发布或部署；原报告均注明本地验证与生产待复验。

# 后续

本地修复/验证/回写完成，验证回执见agentwiki/docs/verification/bug-report-20261022/README.md；发布前另行准备版本、配对备份、部署/生产真实验收。之前onboarding-host-identity修复在同一工作树，需一并保留。
