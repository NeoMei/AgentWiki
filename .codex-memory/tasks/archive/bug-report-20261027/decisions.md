# 决策

- 仅在锁定 canonical 分支实现；历史 assist-qwen-fallback 禁止作为发布源。
- 报告历史记录原样保留，追加日期明确的新回复，区分代码/本地验证/部署。
- 实际登录、注册入口为 ProductPage，修复必须覆盖真实路由，不能只改独立表单。
- 所有任务板写入共用 Space advisory lock；Human 按 User→Space→live权限重验，ReadCommitted 读到等待后的最新提交。Agent Grant撤销语义不扩展。
- 目录 after 转换为下一同类兄弟 beforeId 或末尾；浏览器fixture和真实PG持久化证据分开记录。
- 本轮不升级版本、不推送、不部署；保留用户未跟踪design/。

- 后续用户明确授权“发布”，原不推送/不部署阶段边界已解除。现GitHub已发布；生产仅被SSH认证条件阻塞，不能因旧阶段说明再次索取发布许可。
- v0.12.63无schema/npm/protocol变化；沿用冻结detached部署与独立主机/公网/浏览器证据。

- SSH认证条件已解除，按既有发布授权完成生产操作。最终源码、包版本、主机、公网、真实浏览器与页面回复分别记录。
- 生产owner临时资源覆盖主要交互；只读角色/原生客户端边界如实保留，不扩大验收声明。
