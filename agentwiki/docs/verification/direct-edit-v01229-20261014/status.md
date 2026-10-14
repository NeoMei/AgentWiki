# v0.12.29 直接修改页面发布验收

状态：候选已从生产 `v0.12.28` 基线构建，待 GitHub 与生产发布后补写外部回执。

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
- typecheck：pass
- lint：pass
- build：pass，初始 JavaScript 548647/550000 bytes
- `git diff --check`：pass

## 外部回执

发布提交、GitHub tag/release、生产备份、部署服务状态、健康检查和登录浏览器读回将在发布完成后追加；未完成前不宣称上线。
