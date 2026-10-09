# 统一 Agent 会话侧栏第一阶段 — 历史验收记录

> 2026-10-07最终补充：旧1735f341混合状态批注P2已由f4325942修复，并通过独立组件探针与真实浏览器验收及清理。本期完成归档；最终结论和边界见[补修验收](../agent-session-mixed-notes-20261007/acceptance.md)。以下仅保留原冻结候选的历史回执。

用户已确认推进 OpenKnowledge ACP 调研后的第一阶段，按指定 p5c07ff/gpt-6-astra / ultra 实施与独立审查。

- 分支 `codex/document-workspace`，工作树 `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki `（尾空格）。基线 `ee9348839924fd7566ff3b67fa72beb6090a77ea`，最终产品 `1735f341167950e58dca935b819bc2e188133f88`；归档文档另行提交。
- 阅读/编辑共享持久会话，支持跨页连续问答、显式参考文档及私人批注、历史来源版本、运行/停止、候选逐项接受与冲突重生成。Markdown单源，接受只改草稿，Save显式执行。
- Task1四项、Task2 R1–R4、最终整体F1/F2（含document/selection）全部独立关闭；最终整体代码审查APPROVED，无未关闭finding。8份审查报告在reviews/，完整SDD回执在/tmp/agentwiki-sessions-20261006/sdd/。
- 服务端159suites/2877通过、26既有skip；客户端最近全量139suites/2091通过（3cc1d78c），最终小修1735f341的8suites/260定向检查及tsc/lint/build通过。JS548914/550000，迁移61文件corpus独立批准、6保护检查通过。
- 实际13项API/DB/worker验收通过；真实生产构建CUA覆盖阅读批注引用发送、跨页刷新历史、两hunk+人工改稿+逐步Undo、冲突/重生、1280/1600/390、宽表滚动、Stop；F1真实8秒延迟响应切编辑/F2整篇重生成解决原note均通过。
- 隔离fixture显式Save后完整3589字符API/DB精确读回，sibling未改；最后F1/F2改稿全部撤销且无额外Save。最终清理独立确认running none、schema/ports/ownedfiles移除、公共数据未改。
- 保留本地分支与工作树，不push/merge/release/deploy，原主目录未改。详情见acceptance.md。

## 阶段边界

真实外部provider未加载凭据，CLI回复来自确定性fixture；验收不证明模型生成质量。本机ACP仅port/能力契约，未接本机connector/tools/permissions/FollowMode。每会话100轮，模型最近10个completed轮次/120000字符；接受ledger在应用registry，Undo不回退历史动作/笔记状态。跨SPA在途回执可恢复，不承诺浏览器进程终止后的未完成本机绑定恢复。

浏览器已logout、恢复网络和视口并关闭owned tab；CUA不支持origin storage清除，隔离localhost51904内测试专用模拟笔记/偏好可能仍留存。凭据文件和原始API日志均已删除。
