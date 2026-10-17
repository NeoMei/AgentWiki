# 证据索引

- `agentwiki/docs/verification/retest-20261017/{status.md,acceptance.md,validation.json}`
- 同目录 `candidate-date.png`、`candidate-navigation-runs.png`：候选链路截图。
- `.superpowers/sdd/retest-20261017-plan/`：task-1/2/3 report/review、task-2/3-rereview、build/typecheck/lint/test-full.log；ignored过程证据，不强制提交。
- Web/MCP提交：915d58f4、cbee4b19、ff6885fb、18c05eb1。
- 插件独立工作树：`/Users/neomei/.codex/worktrees/retest-20261017/AgentWiki-Obsidian`；最终候选15c37be；task-1-rereview2.md确认P1/P2清零，主仓final-branch-review.md通过。
- 私有 `source-feedback.md`、`production-*` 仅本地参考，禁止提交；公开交付不包含原账号/页面ID/生产响应。

- 正式Web源码：https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.47 ，a192d775；插件：https://github.com/NeoMei/agentwiki-sync/releases/tag/0.5.12 ，fd06387。
- 发布阶段权威回执：agentwiki/docs/verification/retest-20261017/release.json；原页进度ChangeSet cmvbwqnjz00bjrinsnvx39hrd。
- /tmp/agentwiki-release-20261017/full-release-retry.log exit0；原失败full-release.log保留；backup-execution.jsonl verified，release-manifest.json为a192d775的1354文件。
- 正式tgz：.superpowers/sdd/retest-20261017-plan/release-pack/neomei-agentwiki-local-sync-0.13.1.tgz；receipt含完整integrity和文件hash。
- 部署：agentwiki目录 AGENTWIKI_SSH_CONTROL_PATH=/tmp/agentwiki-release-ssh/control bash deploy.sh 113.249.120.24 root 。须先确认npm0.13.1已发布。
- 新包验收脚本：.superpowers/sdd/retest-20261017-plan/release-sdk/verify-installed-gateway.mjs；默认只读，append需显式双flag，保护freshCAS/原文/published/exactreadback。

- 最终原页ChangeSet cmvc730wt00albu4scw93k18c，2026-10-17T09:29:15.171Z，content SHA25642df07a38a7029b18c162f26b2f30db4843230248b753799910d7bd7c3cc48d4。
- 最新配套备份/var/backups/agentwiki/retest-feedback-v01247.xgdw975j；backup-execution-resume.jsonl verified。production-release.json/public-release.json/production-smoke.log（32passed）均通过。
- 私有浏览器证据production-review-date-sort.png、production-navigation-runs.png、production-settings-390.png、production-runs-390.png、production-final-feedback.png和production-ui-receipt.json已ignored，不提交正文。
