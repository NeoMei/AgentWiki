# Decisions

- 新用户授权要求进行全面复审与修复，沿用本地分支，未新增push/merge/deploy授权。
- 全量DB测试使用本任务新建独占agentwiki_audit_test_*数据库，所有schema/数据库级迁移只在该数据库；独占Redis和临时目录。结束按登记所有权清理。
- 审查、实现、测试分工；基线全量运行中禁止product/build并发改动。每个修复先给可复现原因与必要回归，再独立复核。
- 无.codegraph，不自动建立索引；使用rg。git显式--work-tree避免core.worktree漂移。
- Browser插件browser技能未提供，按frontend-testing-debugging使用独立Playwright/Chrome profile，截图和运行证据保存/tmp。

- 全量测试的legacy Sync v2版本门禁只接收agentwiki_sync_version_test_*命名库；另建登记专用库并迁移，不放宽门禁、不指向日常应用数据库。R1/R2失败保留并准确归类为运行配置。
- F2异常跨Space测试只在隔离schema构造不一致关联，不表述为正常写入API可越权制造。
- 新一轮真实UI与MCP使用合成资料和自己的浏览器profile；provider fixture、真实模型结果和实际UI分别记载。

- 最后模板UI R7发现F6：catalog遗漏admin，但共享humanAllowedRoles与实际instantiate允许管理员；不能通过改测试期待legacy回退掩盖产品bug。6dd46114统一能力投影，保留composite结果页并加强Admin来源/版本验收。独立83/83，最终server2994通过；实际新构建UI待验。
