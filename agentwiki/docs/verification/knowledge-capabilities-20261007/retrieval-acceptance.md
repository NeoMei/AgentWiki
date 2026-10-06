# Agent知识读取阶段验收

2026-10-07，结论：**参数可用性通过，引用质量仍有待修项，不能全项PASS。** 本文为阶段性回执；来源更新闭环正在另一份已批准计划实施。没有推送、合并、发布或部署。

## 已交付的本地变化

产品提交60de6602为六个只读工具展示命名参数，保留legacy `__args`，拒绝冲突值，Space路由与写入确认不变。已完成独立任务/整分支审查和实际SDK/HTTP MCP验证。原基线发生过顶层pageId被旧schema丢失，后续候选真实使用命名pageId/query成功。

没有新增搜索算法或context服务。技能增加了现有知识读取流程，安装分发按实际文件验证；本地源文件更新不代表用户已经安装新包。

## 固定实验与结果

前后各两个全新native Codex CLI会话，独立Agent/Credential，requested `gpt-6-astra/high`，8题、最多20次知识调用。CLI不暴露server-resolved model，不能把requested名称当后端路由证明。知识是7页授权合成语料与1个未授权诱饵；真实模型通过实际stdio gateway和生产API读取。没有fixture模型回答，没有向消费者提供rubric。

修正后的验收harness04d6fc12由每消费者一个持久stdio/SDK会话承接相同shell命令，hash为`de7c104f7a4d52a55bf54fa4f25cc60547865bd56477f8b62eed94af005bf248`。额外依赖runner的实际字节也已核对相同。旧产品固定ffd0482f、仅覆盖四个已审验收文件，产品源码hash与首次基线一致；候选固定1418d584（产品60de6602加harness/文档）。语料及题目hash前后一致，详见同目录retrieval-result.json。

| 指标 | 旧版a | 旧版b | 候选a | 候选b |
|---|---:|---:|---:|---:|
| 核心事实正确 / 实际依据可追溯 | 8/8 | 8/8 | 8/8 | 8/8 |
| 严格逐题引用覆盖 | 8/8 | 8/8 | 7/8 | 7/8 |
| 知识调用 / MCP失败 | 10 / 0 | 11 / 0 | 13 / 0 | 12 / 0 |
| 搜索调用 | 0 | 0 | 4 | 2 |
| 含发现的响应字节 | 33,196 | 33,352 | 34,396 | 31,496 |
| 模型运行墙钟秒 | 47.33 | 95.75 | 58.98 | 204.87 |

每场一次工具发现与一次持久gateway会话，启动耗时分别163/124/160/120ms，不能再与旧harness逐调用重启的gateway耗时混合。CLI实际usage及SDK耗时保存在JSON，不把缓存token加到input重复计数，不推算价格。

独立评分确认：候选q4虽然引用了足以支持结论的干扰文档，但漏了rubric要求的正式规则引用；分数保留7/8。候选a的q3把真实SourceId `kr_source_save`误称为来源版本，虽然其他实际page/evidence及v2可追溯，也必须保留该标注错误。候选b发生一次provider stream断开与CLI自动重试，204.87秒完整计入；这不是MCP错误，也不能据此声称整体更快。四次运行均有宿主skill-description预算警告，与产品调用失败分开记录。

两场新候选实际使用中文别名搜索且正常取回证据；旧版只遍历小语料，故这不是搜索排名或大型语料召回的对照。原本事实已满分，不能宣称准确率提高；两例样本也不支持总体成本降低。

## 原失败没有被覆盖

首次候选b保留4次错误。定向时序复播确认额外gateway启动/discovery流量触发120/min凭据限流，随后新进程发现不到工具。修的是验收封装，没有提高或关闭产品限流。原结果见retrieval-initial-result.json，因果边界及HTTP计数见retrieval/task-3-transient-investigation.md。新旧传输口径不同，因此双方均已重跑，没有只挑选替代候选。

## 权限与清理

所有真实模型会话只执行指定只读facade；没有读state/fixture、执行任意SQL/HTTP或调用写工具。私有sentinel没有出现在答案、事件或trace。另行operator通过同一实际网关验证中文别名搜索成功、读取未授权pageId明确拒绝；不将这两次调用算作模型行为。

每个实验使用自有随机schema、Redis、API、a/b home/credentials/socket，所有runtime已CLEANED。root独立检查API端口、harness/API/Redis/gateway PID、state、home和两处IPC目录均消失；保护性公共库存digest始终`6191ee0d4c7a10c831beec7d159577e65eba7ba68ae2fcbf6b21e2758c785ea6`。旧产品验证checkout的app归档工具报告归属/managed元数据错误，未绕过删除；仅该checkout与依赖保留，没有运行进程。

## 后续门禁

来源状态DTO将明确区分SourceId、已复核与当前SourceVersion ID/版本/代次。技能仅补通用引用规则：比较或驳回旧/干扰资料时同时引适用依据，不引入题目专用提示。完成来源生命周期与UI后，以同一8题/语料/模型/预算再次检验整合候选，保留全部旧分数；历史fixture的未知来源状态不能伪造为current。

本轮无新增UI功能，不能充当来源更新UI验收。ACP仍仅原接口定义，未新增本机Agent接入。真实模型provider、合成知识输入、实际API读取、产品实现、独立审查及待验项均分别记录。
