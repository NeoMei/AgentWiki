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

- native新子代理派发已两次触发thread limit，后续复用原只读规划上下文或原实现者；如实记录非fresh，独立审查者不参与实现。真实消费者由ephemeral CLI新会话执行，仍保持新身份与前后同配置。
- 初始检索实验发现验收facade额外discover流量；不放宽产品120/min凭据限流，改每消费者持久gateway并重跑双方。旧分数/失败原样保留。
- 来源状态使用返回正文同一Page快照；共享底层代次比较器支持无Page ID新建候选；所有公开Page/Review读及mutation回包采用同一权限投影。

- 实际整合八题仍未通过无退步质量门禁；按预先批准的无收益fallback，在ddfaf538撤回五步检索coaching及双引策略。只保留已证实参数兼容修复及来源状态/版本的客观语义，不以反复调提示追分；旧分数及失败不改。
- 来源闭环在bf7787b6真实OKF/worker/UI/模型验证；UI两处修复3b8c918f单独实际复验，回滚截图的操作者等待缺口被独立发现后以第三隔离runtime补证，原失败保留。

- 最终scoped ddfaf538两位真实消费者参数/source标签/unknown语义通过，A事实7/8、B8/8，严格引用仍各7/8；全部旧结果保留。独立整分支批准有限产品范围，未关闭Critical/Important为0。研究及本地实现归档结束，不以额外提示调优或重复运行追分；后续部署/升级独立授权。
