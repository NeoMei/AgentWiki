# Decisions

- 已获方案实施授权，不重复询问相同范围。具体实现优先现有工具与真实来源关联，收益不足不增加新检索系统。
- 每个实质任务fresh实施代理，独立spec/quality审查，最终整分支审查；模型沿用用户确认的p5c07ff/gpt-6-astra。
- CodeGraph目录不存在，使用rg/read；不自动索引。
- Git显式--work-tree；不改core.worktree。新工作树独立安装依赖，不复用可变生成产物。
- 测试仅隔离合成数据，不上传真实用户知识或改线上资源。真实Agent结果与模拟模型/结构测试分别记录。

- 2026-10-07实施细化：检索基线使用全新native Codex gpt-6-astra/high消费者（CLI不支持app的p5c07ff路由标签），前后同配置，服务端实际模型名若未回传则明确unknown；实施/审查继续使用native p5c07ff子代理。
- 来源复核采用受验输入head+generation、Run固定输入和Page已审代次；另增持久intake幂等回执覆盖noop/existing。严格处理A-B-A及同key重放，不推断历史记录当前有效。
- 所有实际正文/format/来源关联修改入口清除已审代次；只有服务器验证的ingestion发布和精确revert能赋值，客户端payload不能声明已复核。
- 独立设计审查发现并补齐幂等noop、Sync/附件等writer及human/PAT事务授权缺口；无生产迁移。
