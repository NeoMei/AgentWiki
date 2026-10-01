import { describe, expect, it } from 'vitest';
import { messages } from './messages';
const keys = ['collaboration.wizard.step2Help', 'settings.approvalHelp', 'agent.approvalModeReadonlyHelp', 'agent.localSync.publisherGovernance'];
describe('localized Agent role guidance', () => {
  it.each(keys)('uses native language roles in %s', (key) => {
    expect(messages['zh-CN'][key]).not.toMatch(/Reader|Editor|Publisher/u);
    expect(messages['zh-CN'][key]).toContain('发布者');
    expect(messages.en[key]).toContain('Publisher');
  });
});
