# 当前目标

- AgentWiki v0.12.10 Toast 自动消失修复已发布并部署，保留生产已有 Assist 修复。

# 范围 / 不做

- 本轮修复问题清单 #3：成功和错误 Toast 均三秒自动关闭；其余缺陷未处理。
- 不发布 Local Sync 或 sync protocol，不执行数据库迁移。

# 当前状态

- GitHub v0.12.10 发布提交：484e3f16318573dbe56d9a84dfca7e342eeed499。
- RED 4 fail / 7 pass；GREEN 11 pass；客户端111文件/1526测试通过。
- 最终服务端153套件/2666测试通过，26测试跳过；本地build、typecheck、lint、33项版本契约通过。
- 根pnpm test在数据库运行时门禁退出1（缺少隔离数据库配置及既有迁移哈希不匹配），不可称全仓验收通过。
- 2026-10-01 02:06（北京时间）生产更新为0.12.10，API/Worker/Frontend active，公网health五项ok。
- 生产树为上一生产树叠加八文件发布补丁，保留未进入GitHub候选的Assist修复；不是tag的完整逐字节副本。
- 暂存应用构建通过；Local Sync构建缺SDK模块失败，部分dist已隔离，保持生产原先无Local Sync dist状态。
- 公网入口引用新Toast bundle，哈希与服务器一致，已确认三秒定时器无success专属限制；尚未做登录态向导实测。

# 稳定约束

- 主仓和本worktree路径末尾空格；Git显式--work-tree，保留原主工作区脏文件。
- 发布、部署、健康检查、真实页面验收分别报告。
- 不以GitHub tag覆盖线上尚未收录的修复。
- Folder为目录，Page承载正文；权限、CAS与treeRevision保留。

# 关键索引

- agentwiki/docs/releases-v0.12.10.md
- agentwiki/apps/client/src/components/Toast.tsx
- agentwiki/apps/client/src/components/Toast.spec.tsx
- 配对备份：/var/backups/agentwiki/toast-v01210-20261001020626
- 上一应用：/root/agentwiki-previous-toast-20261001020626

# 风险 / 下一步

- 已打开的旧浏览器标签页需刷新以加载新资源。
- 其余缺陷、全仓隔离数据库门禁、Local Sync构建环境和登录态向导实测未闭环。
- SSH使用临时control socket认证，勿记录或输出密码。
