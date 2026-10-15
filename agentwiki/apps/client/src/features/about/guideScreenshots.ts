// Keep language selection explicit: translating captions cannot translate image pixels.
const screenshots = {
  agents: ['step1-agent-list', 'step1-agent-list-en'],
  members: ['step2-space-members', 'step2-space-members-en'],
  publish: ['step5-opencode-publish', 'step5-agent-publish-en'],
  result: ['step6-opencode-success', 'step6-agent-success-en'],
  page: ['step6-published-page', 'step6-published-page-en'],
  activity: ['step6-activity-log', 'step6-activity-log-en'],
  localPreview: ['step5-opencode-publish', 'local-sync-preview-en'],
  localResult: ['step6-opencode-success', 'local-sync-result-en'],
} as const;

export const guideScreenshot = (name: keyof typeof screenshots, zh: boolean): string =>
  `/screenshots/${screenshots[name][zh ? 0 : 1]}.png`;
