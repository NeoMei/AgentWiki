# 决定

- 用户2026-10-13最新指令优先于10-03/10-09旧设计和已安装Skill。旧实现是待修对象，不能用于要求用户重复接入。
- Credential归属Agent，live Grant按agentId+spaceId确定角色。删除Grant不删除凭据，不影响其他Space。
- legacyAuthorizationId可保留审计信息但不参与权限；旧有效key按现有Agent Grants工作，已撤销/删除的key不恢复。
- 同一gateway固定所选Agent/服务端/客户端身份，不借其他凭据重试。知识数据和Preview仍Space隔离。
- 不改变人类同步设备授权。现有install space/role仅作为bootstrap上下文。
- 原文档远程读写只MCP，不用浏览器或直接API绕过。

- 用户2026-10-14明确授权发布软件；Web 0.12.25 / Local Sync 0.12.0 / protocol 0.6.1 已分别验收。
- 用户随后明确允许 Publisher 自动发布；主代理应用审核政策并继续 MCP 模板发布。政策授权、实际策略更新、提案创建和正式回读分别记录，不能相互替代。
