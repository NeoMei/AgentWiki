# AgentWiki v0.12.64 — 跨页笔记与主站蓝色标志

已发布至 [GitHub Release](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.64)，并部署至 https://agentwiki.quukk.com 。冻结源码为 `190ba1b34c2cb03691cc82bfbe4aa3bc2a7e725c`；后续只追加审计文档，部署源文件保持此提交。

- 默认“当前页面”，可切换“全部笔记”；支持本空间/全部有权限空间、作者/@我/状态筛选、正文/引用/页面标题检索、分页和来源。
- 跨页打开选中卡片、失效选区降级、返回检索筛选与有界位置恢复；原当前页草稿和操作保留。
- 天枢中国结改为主站 `#155DFC`；Web/Client/API 0.12.64，Local Sync 0.13.5，protocol 0.6.1。

## 验收证据

| 证据 | 结果 |
| --- | --- |
| gates.json | `test:full` exit 0；8492 pass / 0 fail / 9 条件 skip；typecheck/lint/build通过，初始JS550514/551000 |
| gate-attempts.json | 保留初次 migration 指纹期望未同步和一次测试等待竞态的失败历史；修复后完整重跑通过 |
| independent-review.json / evidence-consistency-review.json | 整分支独立复审无未关闭重要问题；源码、日志与生产回执一致性独立核查通过 |
| source-manifest.json / source-preparation.json | 1461 个冻结源文件；manifest SHA256 `e1a916be2ca380969f2a6de1e2f5aa4ac4a54d5a47218ef98cb39369e744ed5c` |
| backup.json / backup-restore.json | 应用、配置、DB和附件配对备份及隔离恢复通过，临时恢复库已移除 |
| deployment.json / production-host.json / production-public.json | 干净detached部署exit0；1461源码一致，3服务active，5healthok，公网HTML及5入口资源一致 |
| local-browser.json / production-browser.json | 两环境各13/13真实Chrome业务验收；生产27笔记/4页面/3空间/2账号全部删除并逐项读回 |
| github-release.json / cleanup.json | 正式latest Release、tag准确指向冻结源码；本轮临时runtime与发布检出已清理 |

9项条件跳过为：独立CodeGraph实际scanner opt-in 1项、专用connection数据库3项、专用taskboard数据库4项、Windows ACL 1项。笔记发现31项真实PG测试已纳入完整门禁且未跳过。真实浏览器仅使用本轮隔离账号和资源，无模型调用；这不替代历史任务列明的原账号/原生客户端待验事项。

敏感备份保留服务器私有目录；回滚必须配对应用、配置、数据库和附件，并考虑备份后新增写入。工具用法见 release-tools.md；tools-validation.json 仅证明工具自身的mock/语法验证。
