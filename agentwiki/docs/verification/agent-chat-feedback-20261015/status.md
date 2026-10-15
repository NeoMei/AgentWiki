# Agent 聊天反馈 v0.12.37 发布

已于2026-10-15发布GitHub并部署生产。发布提交 `9b7a3b90efd538bcea067fbab0344fec856d9b6f`，tag `v0.12.37`。

- 整合最新v0.12.36，完整回归7518 passed / 6 existing skipped / 0 failed；239数据库测试零跳过。API/Worker生产模块编译包含在服务端完整套件。build/typecheck/lint与独立集成复核通过。
- 备份：`/var/backups/agentwiki/chat-feedback-v01237.o8m783ek`。数据库custom dump、应用、配置、附件配套备份与SHA256校验通过；保留旧应用 `/root/agentwiki-previous-20261015191331`。
- 生产1328个源码文件与发布提交匹配，3个服务active、5项health全部ok，公网HTML及入口资源hash一致，32项公网烟测通过。原有凭据/Grant/Agent/Space策略稳定字段摘要在部署前后完全相同。
- 真实provider问答和修改候选均done；观察到preparing/waiting/generating，公开进度只有phase/attempt，终态进度清除，生成候选不改保存正文。
- 真实IAB生产浏览器：发送即排队，随后生成阶段/7秒/停止可见；完成后仅1个接受按钮、差异默认折叠。接受后数据库正文hash与updatedAt不变；显式Save后两者变化且出现新增标题。控制台error/warn为0。
- 临时浏览器空间/页面及API探针账号/空间均已软删除并核对，0个运行/排队测试任务；审计历史按产品语义保留。任务创建的浏览器标签已关闭，用户恢复的SSH连接保留。

执行反馈为真实阶段，不是逐字流式输出。Local Sync0.13.0、协议0.6.1不变，无新增数据库迁移或依赖。完整回执见deployment.json；本地桌面/390px验收见任务refs。
