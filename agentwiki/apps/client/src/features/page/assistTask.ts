// Builds a self-contained task brief the user hands to their local agent
// (e.g. opencode). The agent reads the page snapshot and intent, then proposes
// changes through propose_page so a human reviews before publishing.
export interface AssistTaskInput {
  baseUrl: string;
  pageId: string;
  pageTitle: string;
  intent: string;
}

export const buildAssistTask = (input: AssistTaskInput, zh: boolean): string => {
  if (zh) {
    return [
      '# 编辑辅助任务',
      '',
      '请帮我编辑 AgentWiki 中的一篇文章。',
      '',
      '## 文章',
      '- 标题: ' + input.pageTitle,
      '- pageId: ' + input.pageId,
      '',
      '## 我的意图',
      input.intent,
      '',
      '## 步骤',
      '1. 用 get_page 读取 pageId=' + input.pageId + ' 的当前内容和 updatedAt。',
      '2. 按上面的意图改写出新内容。',
      '3. 用 propose_page 提交你的修改建议（spaceId 用文章所属空间，expectedUpdatedAt 用刚读到的 updatedAt）。这会进入人工审批，不会直接发布。',
      '4. 完成后告诉我你提交了什么改动。',
      '',
      '注意：不要直接改原文；通过 propose_page 提交候选，由我审批。',
    ].join('\n');
  }
  return [
    '# Editing assist task',
    '',
    'Please help me edit a page in AgentWiki.',
    '',
    '## Page',
    '- Title: ' + input.pageTitle,
    '- pageId: ' + input.pageId,
    '',
    '## My intent',
    input.intent,
    '',
    '## Steps',
    '1. Call get_page for pageId=' + input.pageId + ' to read the current content and updatedAt.',
    '2. Rewrite the content according to my intent above.',
    '3. Submit your proposed changes with propose_page (use the page\'s space, and expectedUpdatedAt from what you just read). This goes to human review and is not published directly.',
    '4. Tell me what you changed.',
    '',
    'Do not edit the original directly; submit a candidate via propose_page for my approval.',
  ].join('\n');
};
