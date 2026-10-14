# v0.12.29 直接修改页面发布验收

状态：已发布并完成生产与登录浏览器回读。

## 变更边界

- 编辑权限用户在阅读页 Agent 侧栏显式选择“直接修改页面”。
- 请求仍使用现有 Assist `proposal` 生成完整候选。
- 页面写入由当前登录用户的编辑权限完成，复用 `PATCH /pages/:id` 与 `expectedUpdatedAt` CAS。
- 写入前重新读取当前页面并校验 Space、页面、编辑权限、候选基线版本；冲突直接拒绝，不覆盖页面。
- 问答、只读账号与编辑器候选审阅/显式保存流程不变。

## 本地门禁

- 基线：`origin/master` / `v0.12.28`
- 客户端直接修改定向：98 pass
- 客户端全套：151 files / 2471 pass
- Server：177 passed，1 skipped suite；3163 passed，4 skipped tests
- Sync Protocol：10 files / 140 passed
- Local Sync：71 files / 998 passed，1 skipped
- Runtime DB：149 suites / 239 passed
- typecheck：pass
- lint：pass
- build：pass，初始 JavaScript 548647/550000 bytes
- `git diff --check`：pass

## GitHub 回执

- 发布提交：`f629983a76bb3aa5a1e0b3aa65c4212d8c0e4c14` (`release: publish AgentWiki 0.12.29 direct page editing`)
- Tag：`v0.12.29`，指向上述提交
- Release：[AgentWiki v0.12.29](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.29)
- Web/API 包版本：`0.12.29`
- Local Sync：`0.13.0`，未变更
- Sync Protocol：`0.6.1`，未变更
- 数据库迁移：无

## 生产回执

- 目标：`root@113.249.120.24:/root/agentwiki`
- 部署时间：2026-10-15 00:07（Asia/Shanghai）
- 生产包版本：root/client/server 均为 `0.12.29`
- 部署脚本保留上一版本：`/root/agentwiki-previous-20261015000706`
- API、Worker、Frontend 进程均存活；生产本地 API 和公网健康检查均返回：`status=ok`、`database=ok`、`redis=ok`、`auditPersistence=ok`、`attachmentStorage=ok`
- 公网入口：`https://agentwiki.quukk.com`
- 公网 HTML 引用 `/assets/index-BhwdmaEv.js`；候选与生产该资源 SHA-256 均为 `12d8871e8f33738c4d5bcbdaf8ca5df001b6dd9880ad3f9d32e865dc546f33d8`

## 登录浏览器回读

- 页面：`https://agentwiki.quukk.com/pages/f285b898-65ba-4938-8616-e9a0b8f575f5`
- 已登录编辑用户在 Agent 侧栏看到并选择“直接修改页面”。
- 页面回读显示修改范围为“整篇文档”，并显示“完成后会再次检查页面版本，并直接保存；版本冲突时不会覆盖页面”。
- 本次只做模式与版本提示回读，没有向现有项目页面提交测试内容，避免污染真实文档。
- 浏览器业务请求中页面、空间、内容树、Agent 会话请求均返回 200；未执行生产页面写入，因此没有虚构 PATCH 回执。

## 结论

v0.12.29 已从生产 v0.12.28 基线构建、验证、推送 GitHub 并部署到生产。内置 Agent 的直接修改入口已经在公网登录页面可见；实际页面写入仍受编辑权限与 CAS 冲突保护约束。
