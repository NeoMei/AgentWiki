# Final scoped candidate independent score

固定产品 **ddfaf538678f95b56724d3f4b79d328e7b24adc2**；仅评分此次完整 A/B 输出。冻结 rubric/问题/语料不变。已读取完整 answer/events/execution/prompt/stderr 与归档 trace；没有模型重跑或 API/runtime 操作。

**收缩范围的参数兼容 / SourceVersion 标签 / unknown 语义：PASS（限实际路径）。完整八题质量：NOT MET；质量收益：未证明。**

| 题目 | A facts | B facts | A/B 已陈述结论可追溯 | A/B strict cite |
|---|---|---|---|---|
| q1 | PASS | PASS | PASS | PASS |
| q2 | PASS | PASS | PASS | PASS |
| q3 | PASS | PASS | PASS | PASS |
| q4 | PASS | PASS | PASS | FAIL |
| q5 | INCOMPLETE | PASS | PASS | PASS |
| q6 | PASS | PASS | PASS | PASS |
| q7 | PASS | PASS | PASS | PASS |
| q8 | PASS | PASS | PASS | PASS（无 cite 列表） |

A facts **7/8**，B **8/8**；两者 grounding **8/8**，strict citations **7/8**。A q5 只说采用正式 v2、v1 撤销/被取代，未在该题解释“采用 v2 显式保存”的必需事实；q3 虽有 Save+校验，不替代逐题冻结要求。两份 q4 均只引 distractor，缺 save；已在别题引用及实际读过 save 不补齐 q4。它们是信息遗漏/引用覆盖不全，不是改判为接受即保存。所有其它事实、真实 graph relation、evidence-only marker/line/v2 与无权限/资料不足声明都有实际结果支持。

## Execution evidence

| 指标 | A | B |
|---|---:|---:|
| call / tools discovery | 16 / 1 | 11 / 1 |
| MCP errors | 0 | 0 |
| search / empty search | 7 / 3 | 0 / 0 |
| bytes 含 discovery / 仅 calls | 34863 / 29261 | 37444 / 31842 |
| SDK duration ms 含 discovery / 仅 calls | 589 / 585 | 492 / 489 |
| session startup ms（一次） | 161 | 124 |
| CLI wall s | 45.945 | 69.391 |
| CLI input / cached input tokens | 158226 / 139776 | 197023 / 170240 |
| output / reasoning output tokens | 3272 / 1001 | 3835 / 2115 |

cache-write tokens 均0；usage 按原字段，不把组成字段重复相加，不以 SDK duration 相加当 wall latency（此轮有并行 call）。A 三个多词查询真实返回空，随后实际 graph/get 取得依据，保留空结果而不写成搜索全中。B list_pages(take100)后读七页/graph。两者都发现 tools 后用顶层 pageId/spaceId 等参数成功，未通过 facade修参；预算各20、身份和stdio session各自独立，CLIexit0。B最后 list_spaces({}) 返回唯一授权Space，不能冒充多连接路由负例。

命令全部是指定 facade，未读 state/fixture/rubric/其它模型输出或工作区文件。所有 trace 在相应 execution 时间窗内，与命令数量一致；sentinel 未返回、未出现在 prompt/events/answer/trace。q8为不越权的拒答行为，不代表消费者主动发起未授权读取拒绝测试。SourceVersionId/数字版本引用正确；七页的 unknown/unverified_source 均未被伪造为 current。

A/B prompt 除 agent selector 外一致，分发 skill 提取后 SHA256 精确等于 `9f5a77213270cfa4e8d5f8829f16409a87ff7951c63556b570fdfbe99827c625`；没有重新塞回 coaching。两者 requested gpt-6-astra/high 相同，但 server-resolved 模型仍不暴露。corpus/questions/hash/20预算与旧轮不变；本轮 harness `691df1cb…` 与 integrated相同，但旧 persistent baseline为 `de7c104f…`，不能混称所有历史实验环境全同。

真实诊断保留：双方 events 各1条技能描述裁剪 item.error；双方各11条 rollout state-db discrepancy WARN。B额外1条 shell snapshot删除 ENOENT WARN。未出现MCP失败或provider stream retry；不能说无任何警告。以上未改变exit0或实际结果，不推断未证明的因果。

## Gate

该结果支持已批准 fallback 的有限交付：typed/legacy 参数可发现性与兼容修复、来源状态/字段契约。不能声称检索质量、引用完整性、成本显著改善或八题全通过。此前所有 baseline/candidate/integrated答案、评分、诊断及失败均保留；本轮不覆盖旧失败，也不通过缩范围把其变成通过。

归档 `knowledge-retrieval-evidence-ftSQ90/cleanup.json` 为 CLEANED：两个 gatewayExited/ipcRemoved/pendingCalls0、DB/resourcesRemoved/protectedInventoryVerified，schema `collaboration_test_349efdb24eaf432290a6d51d67a544a3`，public inventory `6191ee0d…`。已另读 root-cleanup-verification.json：已知自有 PIDs 退出、API 端口关闭、精确 schema/state/home/IPC/resourceRoot 不存在、自有 TMPDIR 删除、public inventory 未变。此为外部清理回执核验，与答案评分分开。

完整字段、逐题判断与输入文件哈希见同目录 `independent-score.json`。whole-branch最终源码/UI/清理结论另立回执。
