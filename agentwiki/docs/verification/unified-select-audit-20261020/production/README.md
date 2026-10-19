# v0.12.55 生产验收

2026-10-20发布完成，冻结提交 `fb61b3cc55558b8e71aa05ad15a33aafa40b8f51`。GitHub正式版本与部署源码一致；后续文档提交只归档验证证据。

## 验证结果

- `pnpm build`、`pnpm typecheck`、`pnpm lint`、单次 `pnpm test:full` 全通过。8117 passed / 6既有skipped / 0失败；数据库239项零跳过。两个自动隔离数据库、Redis6392与临时目录清理已独立复核。
- 本地模板6条E2E、24组跨组件渲染/交互检查通过。56/56迁移属性/事件/选项经两次独立AST核对，无业务差异。
- 新配套备份 `/var/backups/agentwiki/selects-v01255.aeirxzlk`：生产基线0.12.54/e067fa37；数据库custom dump、应用与配置、全附件快照和清单校验通过。备份期间暂停API/worker后恢复；独立复审重新核验10项归档hash及旧1389源码清单。未执行恢复演练。
- 生产1393项源码与固定候选一致；公网HTML和5入口资源hash匹配；API/worker/frontend active；status/database/redis/auditPersistence/attachmentStorage全ok；64迁移无待办或失败；两处环境配置字节保持。
- 原用户真实生产浏览器20项检查通过，22份样式测量。模板7页页面组的普通/Tab聚焦/切页/放大/390px、Agent范围、看板来源与图谱筛选/节点选择均已验证。统一桌面32px、手机44px、8px圆角、14px字号及同一箭头；焦点保留轻量可见ring。
- 捕获319请求、90 API请求，2个POST仅模板预览与Markdown解析；业务写入、创建/更新/删除、Agent发送均为0。新建标签页与独立会话已关闭，视口模拟已解除。

## 明确边界

- 当前账号为editor、canManage=false，模板管理入口依权限隐藏；管理筛选在本地真实组件矩阵已验，未借本次样式检查提升权限。
- 原项目看板无任务，jump/status控件未作生产交互通过声明；本地真实组件含80px跳转框、状态选择与长文本已经验证。
- 图谱无关系，关系筛选只有全部项；节点选择与详情更新可真实验证。
- Agent范围只聚焦，不修改选择或发送消息。读取一个既有不可访问Agent会话出现GET400及一条控制台错误，已记录；未把生产环境称为零错误，也未扩展修复该问题。
- 高对比模式、禁用及原生表单语义在本地浏览器/组件检查通过。不同OS的原生选项弹出层保留系统行为，未声称逐OS验收。

## 回执

- `validation.json`、`local-ui-receipt.json`：本地发布门禁与夹具视觉验收。
- `code-review.md`、`frozen-release-review.json`：源码迁移与固定发布包独立审查。
- `backup-receipt.json`：配套备份核验；`source-manifest.json`和`verify-release.py`：固定候选逐文件验证。
- `production-{host,public,migrations,config}.json`：生产部署/健康/资源/配置。
- `production-ui-receipt.json`：独立实际生产浏览器检查、网络写入审计及限制。
- `final-release-review.json`保留生产UI回执到达前的独立收尾审计；其等待项由`release-completion.json`关联本次真实UI结果关闭。
- `github-release.json`、`log-digests.json`：正式发布与原日志摘要。

原始截图、debug和执行日志仅保留私有临时目录，未提交账号身份或业务正文。Local Sync0.13.4与protocol0.6.1保持，没有npm发布。
