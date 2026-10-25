# 决策

- 固定授权/目标/CAS及严格parser不变。
- 可容纳时完整目录inline；整个prompt双预算，超限整批回退。
- 历史正文只在prompt exact去重，存储保持原样。
- 原2读工具40KiB字节分页，保留Unicode边界及所有内容；撤回被OpenCode截断的批量工具。
- 失败原因只暴露白名单code。
- 真实原案probe只读；生产保存验收在同Space隔离9篇副本，通过人类登录浏览器触发。
- MCP get_page误脱敏2个标签，副本以限定page IDs的只读Prisma原文和逐字hash核验，MCP正常授权创建，禁止直接DB写业务正文。
