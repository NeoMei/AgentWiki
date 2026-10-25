# 当前目标

修复 AgentWiki 内嵌 Agent 反复执行失败，并保留真实用例与内容准确性验收边界。

# 范围 / 不做

修复授权目录完整输入、重复历史、工具输出截断和失败原因展示。原 Bug 状态汇总表未覆盖；不放宽权限、固定目标或 CAS，不改 provider 凭据和 Local Sync/protocol。

# 当前状态

- 生产 v0.12.60，冻结源码 `99e66da0e72be583a9d1363760f17f2481a9d4ba`，已部署。1436 源码 hash、三服务、五健康项和公网入口/5资源通过。
- 失败根因：9篇正文137879字符+10轮历史115789字符，串行读取及格式前言触发重试，耗尽300秒。现按完整prompt预算全量inline、历史exact去重、读工具40KiB精确分页，并显示安全failureCode。
- 最终生产原案只读回放147111ms，9/9正文exact/hash，无格式重试。隔离9篇副本通过浏览器原句新会话，113.839s完成update，DB正文与result.changes逐字相等，原9页和8非目标副本未变。夹具已正常软删：批次51779f1d-a8a3-423d-9fd6-487a10365967，1目录/9页。
- 内容审查发现旧来源遗漏、10-21链接/批次误配与人工待验限定丢失，故未覆盖原汇总。额外0.12.61提示候选107372ms运行成功但漏掉原有条目，内容验收失败；提示与版本已撤回，产品源码逐文件与已部署99e66da0完全一致。
- server全量3628pass/44专用环境skip，Agent面板89pass，changed ESLint/server+client build通过。后续两次prompt小改均115 runner/history回归通过。
- 中文「天枢」、英文「AgentWiki」，极简中国结Logo保留。Local Sync0.13.5/protocol0.6.1不变。

# 稳定约束

canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`，分支 `codex/agent-autochat-external-opencode`。编辑发布前运行release guard；历史检出禁止发布。生产 `root@113.249.120.24:/root/agentwiki`，root用户级systemd，外部OpenCode2.1.1。Space权限实时查询，固定目标/CAS写入；不直接DB改业务正文。恢复需配对应用/配置/DB/附件并考虑备份后写入。

# 关键索引

- tasks/archive/agent-failure-20261026/{brief,decisions,refs}.md
- agentwiki/docs/verification/agent-failure-20261026/README.md
- agentwiki/docs/verification/agent-failure-20261026/live-deployed-real-inline-receipt.json
- agentwiki/docs/verification/agent-auto-edit-20261026/live-ui-queue-save-receipt.json
- agentwiki/docs/verification/agent-auto-edit-20261026/final-deployed-content-review.md
- 备份 `/var/backups/agentwiki/agent-failure-v01260.PcRiCrTx`；前应用树 `/root/agentwiki-previous-20261026044641`

# 风险 / 下一步

执行/真实保存已验证；内容完整性仍是独立边界，不能把模型success当作业务结论准确。原页保留。0.12.61提示候选未发布；后续准确性需要可验证的逐项来源对账流程，不能以提示追加代替语义验收。生产40条历史running协作记录无active attempt，未顺手清理。免费备用模型认证、billy通知浏览器回验及npm认证保持独立事项。
