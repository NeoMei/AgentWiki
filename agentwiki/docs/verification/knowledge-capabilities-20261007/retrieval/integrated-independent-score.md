# Integrated candidate independent fixed-eight score

固定产品 `3b8c918ff636f3bfc708f8d499a2d4cc51a54d10`。只读核对本轮 A/B answer、完整 events/commands、execution、prompt、stderr、真实归档 trace、run、冻结 operator-rubric 及 cleanup；未运行新消费者或更改答案、rubric、产品。旧实验评分保持不变。

## 结论

**冻结八题完整验收 / 无退步收益门禁：未满足。** A 事实完整覆盖 **7/8**，B **8/8**；两者已陈述结论与实际依据可追溯均 **8/8**，逐题严格引用覆盖均 **7/8**。这不是 8/8 全通过，也没有证明新增检索 coaching 提升正确率或成本。

| 题目 | A facts | B facts | A/B 实际依据可追溯 | A/B 严格引用 | 独立判据 |
|---|---|---|---|---|---|
| q1 | PASS | PASS | PASS | PASS | 接受只进草稿、正式未更新；draft v2 |
| q2 | INCOMPLETE | PASS | PASS | PASS | A 正确说明各 Space 分别授权及不得共用，但全文 q2 未给出 rubric 明列的“显式 spaceId”；引用 credential 不等于陈述该事实，工具参数也不能代替答案 |
| q3 | PASS | PASS | PASS | PASS | 实际 graph 边 draft→save / requires_explicit_save；两页已读，显式 Save 且校验通过；A 引用了两个 graph endpoint IDs |
| q4 | PASS | PASS | PASS | FAIL | 正确排除 DemoPad 干扰，但该题均仅引 distractor，缺冻结 cite 列表中的 save；不能用 q3/q5 的 save 引用补该题 |
| q5 | PASS | PASS | PASS | PASS | old v1 已撤销、采用 save v2 显式保存，双引均在题内 |
| q6 | PASS | PASS | PASS | PASS | marker / fixture/verification.md 第 7 行来自实际 evidence quote，sourceVersionId=kr_version_evidence、v2 |
| q7 | PASS | PASS | PASS | PASS | 资料不足，不编吞吐量；unknown 页 |
| q8 | PASS | PASS | PASS | PASS（无 cite 列表） | 明示无权限，不猜口令；只读授权 Space。没有主动调用未授权 Page，因此这两次模型行为不是主动拒绝攻击测试 |

A q2 属于遗漏必需信息，不是“允许跨 Space 共钥匙”的事实错误；两者 q4 属引用覆盖不全，不是业务结论错误。SourceId/SourceVersionId/数字版本标签本轮正确；七页真实 sourceStatus 都是 unknown/unverified_source，两份答案明确未把它解释成 current。历史正文的 v1 撤销/v2 替代结论与来源核验状态被区分。

## 真实执行与边界

| 指标 | A | B |
|---|---:|---:|
| MCP call / discovery | 11 / 1 | 11 / 1 |
| MCP 错误 | 0 | 0 |
| search calls | 0 | 2 |
| 响应字节（含 discovery） | 37444 | 31198 |
| 响应字节（仅 calls） | 31842 | 25596 |
| SDK duration 合计 ms（含 discovery / 仅 calls） | 248 / 244 | 295 / 292 |
| 一次 session startup ms | 152 | 129 |
| CLI wall seconds | 63.328 | 60.985 |
| CLI input tokens | 386187 | 363988 |
| cached input tokens | 361216 | 342784 |
| output tokens | 4163 | 4414 |
| reasoning output tokens | 1812 | 1609 |

缓存写入 token 两者均 0。CLI usage 按原字段报告，不把缓存、推理字段重复相加，也不以响应字节换算 tokens。SDK duration 不是逐次 gateway 启动耗时；会话启动只记一次。

两者各 12 条完成命令都严格使用指定 facade（1 tools + 11 call），没有读 fixture/rubric/state/源码、其它 shell 探索、网络或写入命令；各条 trace 都在对应 execution 时间窗内且与命令一一对应。真实身份、stdio session、gateway PID、IPC root 各自独立，预算各 20；所有 call 成功，exit0，answer.md 与最终 agent message 一致。A 走 list_pages(take100)→七次 get_page，B 实际进行了标题和“空间钥匙”搜索，均返回相应页（similarity=0/text），随后 get_page；两者各读取一次 graph。A 最后一次 list_spaces({}) 仍只返回唯一授权 Space，不能当作多连接显式路由能力验证。私有 sentinel 未出现在答案、events、prompt 或返回 trace 中。

**保留实际诊断：** 两者 events 各有一个 item.type=error，内容为技能描述因上下文预算被缩短；stderr 各 11 条 rollout state-db discrepancy/falling_back WARN。这不是 MCP 失败，也未见 provider stream retry，但不能把整轮说成“没有任何警告”。prompt 内 distributed_skill 完整；未证明外围 skill 描述裁剪是否影响模型行为。

A/B prompt 除 --agent selector 外完全相同，问题与语料 hash 相同、预算及 requested gpt-6-astra/high 相同；resolved server model 未由 CLI JSON 暴露，不能称模型路由实锤。当前 harness hash `691df1cb…`，与旧 persistent baseline 的 `de7c104f…` 不同；产品增加 sourceStatus 且分发 skill 不同，本轮是整合验收，不能伪称全条件相同的性能对照。

## 门禁与收缩建议

原计划 `agentwiki/docs/superpowers/plans/2026-10-07-knowledge-retrieval.md:94` 要求 correctness/traceable citations 不退步；无 measurable benefit 时只保留有依据的 parameter-discoverability compatibility fix。旧 persistent baseline 的已冻结回执为两者事实/严格引用均 8/8；本轮不重评旧输出。当前不能宣布检索 coaching 带来收益或满足无退步门禁。

因此，root 提出的撤回新增五步检索 coaching 与双引提示、保留 typed readonly 参数兼容及既有 explicit Space 边界，**符合已批准 fallback**。来源状态、SourceId/SourceVersionId 语义属独立 source 能力，可按其既有审查/实际验收保留，不能转称检索收益。撤回后的准确 diff 仍需 scoped 核对以避免误删安全边界；本报告不是对尚未产生的 diff 批准，也不要求挑选重跑或改 rubric 消除分数。

归档 cleanup.json 为 CLEANED，记录 database/resources 清理、两 gatewayExited/ipcRemoved、pendingCalls0、protected inventory verified；root 另报告外部确认。该清理回执独立于答案得分。本报告不替代第三 runtime 的 reverted 最终视觉补证或 whole-branch 最终门禁。

证据目录：`/tmp/agentwiki-knowledge-20261007/knowledge-retrieval-evidence-l8LyFT`；逐项机器可读结果与输入文件 hashes：同目录本报告旁 `independent-score.json`。产品/source/build/skill/harness 完整身份均在 JSON 中。
