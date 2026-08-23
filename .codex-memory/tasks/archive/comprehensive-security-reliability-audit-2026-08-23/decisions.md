# 决策

- 实时授权必须覆盖成功快捷返回、并发唯一冲突 fallback 和任务 retry，不只覆盖主写路径。
- retry 的 requester 永远是当前调用者，不允许沿用原 Run 的 Agent/Credential/scopes。
- WebSocket 房间是受保护数据通道：连接、加入、写入与出站前都要有当前身份/页面权限保证；高频出站使用 1 秒授权 lease 和 page single-flight 控制数据库放大。
- Memory 全状态唯一约束下，归档 hash winner 应在锁内恢复为 active，而不是只过滤 active 后制造 P2002。
- Obsidian 只能有一个用户可见连接流程；旧 URL 只做兼容重定向，不保留第二套实现。
- 应用层 Git 限额与部署层硬磁盘配额必须同时存在；正式 systemd/Docker Worker 使用 256MiB 私有 `/tmp`，其他运行方式开放远程 Git 时要提供等价边界。
