export const fixtureSource = `## 协作中的个人笔记

团队通过共享文档推进项目，个人笔记保留自己的思考和待确认事项。

### 需求评审

每个功能都需要明确的验收条件，并记录 **待确认的业务边界**，方便后续讨论与开发。

涉及数据变更时，需要先经过人工确认，再交给 Agent 执行。

### 开发与测试

- [ ] 复核关键流程的测试结果，补充失败原因和修复反馈。
- [ ] 查看 [项目协作规范](https://example.test/guide)，确认本次变更的影响范围。

### 开发日志

今天完成需求梳理，接下来安排测试和回归。笔记标记不会写入共享正文。
`;
export const fixturePage = {
  id: 'personal-notes-page', spaceId: 'personal-notes-space', title: 'AgentWiki 项目 · 个人笔记',
  content: fixtureSource, format: 'markdown', createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z',
  capabilities: { canEdit: true, canManageAttachments: false }, author: { name: '本地演示' },
};
