<!-- codex-memory:template=task-brief:v1 -->

# 组合式页面组模板与 Agent 协作

## 目标

- 将单页面模板、多页面 Folder/Page 树和可选协作流程统一为版本化组合模板。
- 支持创建时映射 Agent，也支持历史页面后绑定和 Folder 子树批量绑定。
- 页面任务经 Artifact、ChangeSet 和一次人工审核发布。

## 当前状态

- 需求、架构、交互、后绑定、参与者规则、保存目录模板及兼容迁移均已逐项确认。
- 正式设计文档：`agentwiki/docs/superpowers/specs/2026-09-05-composite-page-group-agent-collaboration-templates-design.md`，隔离分支提交 `d5538e5`。
- 用户已确认实施并继续。1–13实现和各任务独立评审完成；唯一整分支审查5 Important/4 Minor已单一修复批次提交17f28da，f4432ea..17f28da唯一限定复审9/9关闭，无新阻塞问题。实现与本地验收完成，保留分支待用户整合决定；不重做旧任务，不重放无关付费模型。
- 最终types/lint/build/test:full exit0，4861pass/0fail/3既有skip，DB167无skip。最终Chrome4六旅程、390px英文、错误归因3/3且未知0、CLEANED；当前产品尚未合并/推送/部署。已跟踪证据agentwiki/docs/verification/composite-template-final-review-fixes.md；执行账本 .superpowers/sdd/2026-09-05-composite-page-group-agent-collaboration/progress.md，旧真实模型回执与失败历史task-13b-report.md分开保留。

## 完成标准

- 正式设计通过用户总体验收。
- 后续实施计划覆盖数据库、服务、客户端、迁移、测试、真实 UI 和灰度回滚。
- 实施已获确认；按计划完成实现与本地验证，发布、推送和生产部署仍需单独授权。

## 边界

- 不修改 Sync v3、Folder 同步语义、附件和 Markdown 图片引用。
- 不 push、不发布、不部署，除非用户分别授权。
