import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { messages } from '../../../i18n/messages';
import { ArtifactPanel } from './ArtifactPanel';
it('localizes generated artifact labels and system task references while preserving Agent names', () => {
  const t = (key: string) => messages['zh-CN'][key] ?? key;
  const run: any = { systemTemplateSource: { slug: 'coding' }, tasks: [{ name: '需求分析 / Requirements analysis', artifacts: [{ id: 'generated', kind: 'markdown', version: 1, status: 'pending', preview: 'markdown v1', previewFormat: 'kind_version' }, { id: 'same-label', kind: 'markdown', version: 1, status: 'pending', preview: 'markdown v1' }, { id: 'custom', kind: 'markdown', version: 2, status: 'pending', payload: { name: 'Evidence is complete' } }] }] };
  render(<ArtifactPanel run={run} t={t} onHistory={() => {}} />);
  expect(screen.getByText('Markdown 文档 v1')).toBeVisible();
  expect(screen.getAllByText(/需求分析 ·/)).toHaveLength(3);
  expect(screen.getByText('markdown v1')).toBeVisible();
  expect(screen.getByText('Evidence is complete')).toBeVisible();
});

it.each([['markdown', 'Markdown 文档'], ['json', 'JSON 数据'], ['external_reference', '外部引用'], ['evidence_summary', '证据摘要']])('localizes generated %s artifact kind', (kind, label) => {
  const t = (key: string) => messages['zh-CN'][key] ?? key;
  const run: any = { tasks: [{ name: 'Custom task', artifacts: [{ id: kind, kind, version: 1, status: 'pending', preview: `${kind} v1`, previewFormat: 'kind_version' }] }] };
  render(<ArtifactPanel run={run} t={t} onHistory={() => {}} />);
  expect(screen.getByText(`${label} v1`)).toBeVisible();
});
