# 当前目标

全站下拉选择控件统一任务已完成，v0.12.55于2026-10-20部署并正式发布；原反馈页面生产只读回验通过。

# 范围 / 不做

客户端56处选择控件、28个业务文件接入NativeSelect，移除局部外观覆盖并增加lint防回归。无服务端业务、数据库、依赖或用户内容修改；Local Sync0.13.4与protocol0.6.1不变，不发布npm。

# 当前状态

- 工作树 `/Users/neomei/.codex/worktrees/template-preview-custom/AgentWiki `（尾空格），分支 `codex/unified-select-audit`；发布冻结fb61b3cc55558b8e71aa05ad15a33aafa40b8f51，后续仅验收文档提交。
- 根因是先前只修复Agent设置的局部样式；全站共享组件现统一箭头、边框、圆角、字号、尺寸与焦点，业务CSS只保留布局。56/56事件、属性和选项独立AST审查一致。
- build/typecheck/lint与单次test:full通过，8117passed/6既有skipped，数据库239零skip；本地6条模板E2E、24组跨组件desktop/390px通过。
- 生产模板普通/聚焦/切页/放大/手机、Agent范围、看板来源与图谱选择控件通过；网络审计零业务写入，自建标签/会话关闭。
- 1393源码及公网5入口资源匹配，3服务active/5健康ok，64迁移无待办，配置字节保持。配套备份selects-v01255.aeirxzlk验证通过，隔离测试环境清理完成。

# 稳定约束

Git在工作树cwd下显式--work-tree指向带尾空格路径；主检出用户改动保留。业务JSX必须用NativeSelect，新增裸select由lint拒绝；样式规则见component-reuse。不要并行执行清理同一dist的build与依赖dist的验证。

# 关键索引

- .codex-memory/tasks/archive/unified-select-audit-20261020/{brief,decisions,refs}.md
- .codex-memory/spec/component-reuse.md
- agentwiki/docs/releases-v0.12.55.md
- agentwiki/docs/verification/unified-select-audit-20261020/production/
- https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.55

# 风险 / 下一步

原账号editor的管理入口依权限隐藏；原项目无任务，jump/status只做本地真实组件验收。生产1条既有Agent会话GET400未扩展修复，未发送Agent消息。备份已核验但未演练恢复；本次下拉样式任务无待办实现或发布步骤。
