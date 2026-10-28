# AgentWiki v0.12.65 — 审核方式与复制反馈

已正式发布并部署：[GitHub Release](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.65)，线上 https://agentwiki.quukk.com 。冻结源提交 `ecf5f027a9cfa953aba264c47e49907d1c43041f`；后续提交只追加审计记录。

交付：新空间默认无需审核，创建时可选择始终审核；空间标题旁显示/修改当前审核方式，Settings顶部独立卡片保留基本草稿；复制按钮紧凑、成功显示已复制3秒、失败提示与重试。旧Space及待审、owner/Agent权限保持。

| 证据 | 结果 |
| --- | --- |
| gates.json | 完整8540 pass / 0 fail / 9条件skip；.65 typecheck/lint/全包build通过 |
| independent-review.json / tools-validation.json | 产品及QA独立复审无重要未关闭问题；发布工具沿用原配对备份/隔离恢复控制 |
| source-preparation.json / source-manifest.json | 1469冻结源码，manifest SHA256 e36270ea737c469fcca2c87e0fca0c750a052e63dd44f8fb2e90f7326c6f2ee5 |
| backup.json / backup-restore.json | 配对应用/配置/DB/附件备份及隔离恢复通过；临时恢复库已清理 |
| deployment.json / production-host.json / production-public.json | 干净detached部署exit0；1469文件匹配、版本.65、3active5healthok、公网HTML和5入口资源一致 |
| policy-preservation-before.json / policy-preservation-after.json | 104个既有活跃Space的审核策略按ID逐项比较，前后SHA一致700eb3a8f2fa861eed0f28ffafd771f9eff182e1dfbf3e69df65e277833294d7；ID明细仅留服务器私有baseline |
| local-browser.json / production-browser.json | 完整API+隔离Chrome各11项通过，生产临时2user/3space/1page/1agent/1grant/1binding清理读回 |
| github-release.json / cleanup.json | GitHub latest .65 tag准确指向冻结源；本轮临时runtime/检出/SSH连接清理 |

复制反馈已部署；本地fixture浏览器曾对两入口实际组件及真实剪贴板成功/失败/3秒复位验收。生产本轮临时空间未在原有协作启动allowlist中，脚本验证禁用与纯绑定保存，明确记录 `clipboardBrowserVerified=false` 与notRun；没有为验收打开生产开关，也没有把这种情况算作线上复制交互通过。NewPageDialog结果页另有组件集成测试。两次额外本地预跑分别受精确Space rollout和无凭据Agent执行能力拦截，保留attempt-1/2失败与完整清理回执；未修改产品绕过限制。

9项skip：独立CodeGraph真实scanner opt-in1、专用connection DB3、专用taskboard DB4、Windows ACL1。历史原账号/原生客户端待验仍保留原任务边界。

备份与旧应用保留服务器私有目录，回滚必须配对并考虑备份后写入。密码/私钥/令牌不写入本目录。工具说明见release-tools.md。
