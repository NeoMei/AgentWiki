import { createSinglePageWorkflow } from './run-expansion.service';
import { inspectCollaborationInputs, parseCollaborationRunName } from './run-input-validation';

const definition = {
  ...createSinglePageWorkflow('writer'),
  inputs: [
    { key: 'text', label: 'Text', type: 'short_text' as const, required: true },
    { key: 'number', label: 'Number', type: 'number' as const, required: true },
    { key: 'boolean', label: 'Boolean', type: 'boolean' as const, required: true },
    { key: 'optional', label: 'Optional', type: 'long_text' as const, required: false },
  ],
};

describe('collaboration input validation', () => {
  it('validates names for every run creation entry point and preserves internal spacing', () => {
    expect(parseCollaborationRunName('  My  run  ')).toBe('My  run');
    expect(() => parseCollaborationRunName(' \t\n　')).toThrow('Run name is required');
  });

  it.each(['', ' \t\n　'])('rejects blank required text %j without rejecting zero or false', (text) => {
    expect(inspectCollaborationInputs(definition, { text, number: 0, boolean: false }).issues)
      .toEqual([{ code: 'COLLABORATION_INPUT_REQUIRED', inputKey: 'text' }]);
  });

  it('keeps zero, false, optional text and intentional user whitespace unchanged', () => {
    const values = { text: ' user text ', number: 0, boolean: false, optional: '  ' };
    expect(inspectCollaborationInputs(definition, values)).toEqual({ values, issues: [] });
    expect(inspectCollaborationInputs(definition, { text: 'x', number: 0, boolean: false }).issues).toEqual([]);
  });

  it('still requires missing numeric and boolean values and rejects wrong types', () => {
    expect(inspectCollaborationInputs(definition, { text: 'x' }).issues).toEqual([
      { code: 'COLLABORATION_INPUT_REQUIRED', inputKey: 'number' },
      { code: 'COLLABORATION_INPUT_REQUIRED', inputKey: 'boolean' },
    ]);
    expect(inspectCollaborationInputs(definition, { text: 'x', number: false, boolean: 0 }).issues).toEqual([
      { code: 'COLLABORATION_INPUT_TYPE_INVALID', inputKey: 'number' },
      { code: 'COLLABORATION_INPUT_TYPE_INVALID', inputKey: 'boolean' },
    ]);
  });
});
