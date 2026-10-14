// Synthetic content for the localhost chat fixture; never a production project receipt.
export const fixtureUser = { id: 'agent-chat-reviewer', name: '项目负责人' };
export const fixtureSource = `## 人与 Agent 一起推进项目

AgentWiki 把需求、计划、开发和验收放在同一份项目知识库中。团队成员和 Agent 根据相同的文档协作，每次变更都留下清晰的来源与处理记录。

### 需求评审

每个功能都有明确的验收条件。评审意见可以直接标在原文上，团队成员能够看到笔记的作者、引用段落与处理进度。

批量交给 Agent 处理时，先核对本次选中的意见，再发送一次完整任务。需要修改正文的建议先形成候选，由成员审阅后接受到草稿。

### 人工确认

Agent 可以阅读已授权的文档，并基于当前页面提出建议。是否接受修改，由正在编辑文档的成员决定。

涉及发布或删除等操作时，需要先确认目标和影响范围，再继续执行。审阅记录保留处理过程，撤销正文不会抹去协作记录。

### 需要讨论的问题

- 多条评审意见如何组织成一次清晰的任务？
- 哪些操作应在执行前征求人工确认？
- 如何让测试报告关联到具体需求与修复反馈？

### 本周计划

| 事项 | 负责人 | 状态 |
| --- | --- | --- |
| 完善需求功能表 | 产品成员 | 评审中 |
| 简化文档内 Agent 对话 | 前端成员 | 开发中 |
| 复核协作权限与回归结果 | 测试成员 | 待验收 |
`;
export const fixturePage = {
  id: 'agent-chat-project', spaceId: 'agent-chat-space', title: 'AgentWiki · 项目协作说明',
  content: fixtureSource, format: 'markdown', createdAt: '2026-10-14T03:00:00.000Z', updatedAt: '2026-10-14T03:00:00.000Z',
  capabilities: { canEdit: true, canManageAttachments: false }, author: fixtureUser,
};
export const fixtureReferences = [
  { ...fixturePage, id: 'agent-chat-requirements', title: '需求功能表', content: '## 需求功能表\n\n| 功能 | 验收条件 |\n| --- | --- |\n| 页面笔记 | 有页面权限的成员均可见，按作者区分。 |\n| Agent 对话 | 发送明确任务后生成回答或修改候选。 |\n' },
  { ...fixturePage, id: 'agent-chat-test-report', title: '开发测试与修复反馈', content: '## 开发测试与修复反馈\n\n每个测试项关联需求、复现步骤、实际结果和修复反馈。\n' },
  { ...fixturePage, id: 'agent-chat-plan', title: '项目任务计划', content: '## 项目任务计划\n\n- 完善需求表\n- 完成实现与审查\n- 记录回归与验收\n' },
  { ...fixturePage, id: 'agent-chat-collaboration-rules', title: '多成员与多 Agent 协作权限、上下文引用和人工审阅规则说明', content: '## 协作规则说明\n\n团队成员和 Agent 根据已授权的项目文档协作，引用内容保留来源，修改候选由成员审阅后接受到草稿。\n' },
  { ...fixturePage, id: 'agent-chat-release-checklist', title: '项目发布前完整验收检查清单、测试证据与问题修复反馈汇总', content: '## 发布前验收汇总\n\n记录每项需求的验收步骤、测试证据、修复反馈和待确认问题，确保发布状态清晰可追踪。\n' },
];
const snapshot = { title: fixturePage.title, content: fixtureSource, updatedAt: fixturePage.updatedAt };
const summary = (id, title, minutes) => ({ id, spaceId: fixturePage.spaceId, title, createdAt: `2026-10-14T03:${minutes}:00.000Z`, updatedAt: `2026-10-14T03:${minutes}:00.000Z` });
const completed = (id, sessionId, intent, answer, minutes) => ({
  id, sessionId, pageId: fixturePage.id, mode: 'question', intent, status: 'done',
  createdAt: `2026-10-14T03:${minutes}:00.000Z`, pageSnapshot: snapshot,
  references: [{ pageId: fixtureReferences[0].id, title: fixtureReferences[0].title, updatedAt: fixtureReferences[0].updatedAt }],
  noteIds: [], annotations: [], progressText: '', result: { summary: answer }, error: null,
});
export const fixtureSessions = [
  { ...summary('agent-chat-open-questions', '待确认的问题', '12'), turns: [completed('agent-chat-question-1', 'agent-chat-open-questions', '读一下这份协作说明，帮我整理目前还需要确认的问题。', `目前有三项需要团队确认：

1. **任务如何组织**：将同一目标的评审意见合并发送，保留每条意见对应的原文。
2. **人工确认的范围**：修改正文先形成候选；发布和删除前明确目标与影响。
3. **验收如何追踪**：测试结果关联需求编号，并记录复现步骤和修复反馈。

建议先完善 [需求功能表](/pages/agent-chat-requirements)，让每个讨论项都有负责人和明确的完成条件。`, '12')] },
  { ...summary('agent-chat-spec-status', '需求进展', '05'), turns: [completed('agent-chat-question-2', 'agent-chat-spec-status', '这份文档已经明确了哪些协作原则？', `已明确的原则包括：

- **共同上下文**：团队与 Agent 阅读同一份已授权文档。
- **作者可辨识**：页面笔记展示作者、引用原文和处理状态。
- **修改可审阅**：Agent 先提出候选，成员审阅后接受到草稿。

下一步可以结合 [项目任务计划](/pages/agent-chat-plan)，把待讨论问题分配到具体任务。`, '05')] },
];
