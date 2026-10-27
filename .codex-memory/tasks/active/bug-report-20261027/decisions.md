# 决策

- 仅在锁定 canonical 分支实现；历史 assist-qwen-fallback 禁止作为发布源。
- 报告历史记录原样保留，追加日期明确的新回复，区分代码/本地验证/部署。
- 实际登录、注册入口为 ProductPage，修复必须覆盖真实路由，不能只改独立表单。
- 所有任务板写入共用 Space advisory lock；Human 按 User→Space→live权限重验，ReadCommitted 读到等待后的最新提交。Agent Grant撤销语义不扩展。
- 目录 after 转换为下一同类兄弟 beforeId 或末尾；浏览器fixture和真实PG持久化证据分开记录。
- 本轮不升级版本、不推送、不部署；保留用户未跟踪design/。
