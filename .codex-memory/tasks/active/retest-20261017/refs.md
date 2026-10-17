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
