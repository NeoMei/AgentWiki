# AgentWiki v0.12.52

内嵌 Agent 可以读取当前授权目录及子目录的文档，无需逐篇添加引用。“遍历当前目录下文档，生成总结”会按目录范围读取内容并在聊天中回答。

聊天不再要求选择问答或修改模式。Agent 根据提示词决定直接回答、修改当前文章，或在当前目录创建文章；只有收到实际保存回执才刷新文档。已有草稿、权限、并发版本和取消保护继续生效。

Web/API/client 更新为 0.12.52；Local Sync 保持 0.13.4，protocol 保持 0.6.1。包含数据库迁移 `20261019131500_assist_auto_mode`，没有依赖或锁文件变更。

实现与真实模型验收见 [目录访问验证](verification/agent-directory-20261019/acceptance.md) 和 [自动聊天验证](verification/agent-auto-chat-20261019/acceptance.md)。生产发布结果已记录于 [发布回执](verification/agent-auto-release-20261019/release.json)。

已部署冻结提交 `05373af7`：8080 项测试通过、6 项既有跳过；64 项迁移无 pending；1377 线上源码文件、公网 HTML 与入口资源一致。三个服务 active、五项健康均 ok。真实模型 API 四场景和浏览器三场景通过，临时验收资源已清理。配套备份已验证，未执行恢复演练。
