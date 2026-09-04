# 决策

- 最终代码身份固定为 `e94fa7b`；证据/记忆提交不改变运行时代码，后续若出现任何非文档改动必须重跑对应门禁。
- 完整测试的 authoritative 命令为 fail-closed `pnpm test:full`，工作树与 clean clone 必须各自有显式 exit 0。
- UI authoritative evidence 使用最终 collection 8 files / 26 tests、单 worker、无 retry；控制会话消失而缺失最终 exit 的并发运行不计入 PASS。
- Socket.IO 提示必须证明精确 `eventSequence` 因果，不能用 substring 或事件数量近似替代。
- session-local PostgreSQL 参数不得参与跨连接 protected inventory；测试专属参数放在 disposable database level 并在销毁数据库时一起消失。
- 缺少 OpenRouter key 属于外部凭据门禁，但不能因此宣称 Assist 成功；Windows-only skip 同样不能被 Mac 结果替代。
- 资源清理坚持完整 ID、名称、端口、schema 正则和非 symlink guard；临时目录与 env 采用可恢复移动，不 broad delete。
